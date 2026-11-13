import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { ident, type Prober, TraceFallback } from '../probe';
import type { Special } from '../route';
import type { Relation, Row, Stage, TraceOptions } from '../types';
import { findTable } from '../whitelist';
import {
  type DmlNode,
  errorFocus,
  instrumentPartitionInsert,
  row,
  targetOf,
  tryRun,
  userResult,
} from './shared';

// Один реальный INSERT: tableoid и ctid поступают из его RETURNING, без повторной вставки.
export async function tracePartitionInsert(
  stmt: ParsedStatement,
  prober: Prober,
  opts: TraceOptions,
): Promise<Special | null> {
  const body = (stmt.ast as unknown as { InsertStmt?: DmlNode }).InsertStmt;
  if (!body?.relation) return null;
  const table = findTable(opts.schema, body.relation.schemaname, body.relation.relname);
  if (table?.kind !== 'partitioned') return null;
  if (body.withClause || body.onConflictClause || body.returningClause?.options?.length) {
    throw new TraceFallback('Пока не анимируется: сложный INSERT в секционированную таблицу');
  }
  const target = targetOf(table, body.relation.alias?.aliasname ?? table.name);
  const regclass = `'${target.sql.replaceAll("'", "''")}'::regclass`;
  const trigger = await prober.run(`
    select 1 from pg_trigger where not tgisinternal and tgenabled <> 'D'
      and tgrelid in (select relid from pg_partition_tree(${regclass})) limit 1
  `);
  if (trigger.rows.length)
    throw new TraceFallback('Пока не анимируется: триггеры на секционированной таблице');
  const leafRows = await prober.run(`
    select p.relid::oid::text, n.nspname, c.relname
    from pg_partition_tree(${regclass}) p
    join pg_class c on c.oid = p.relid join pg_namespace n on n.oid = c.relnamespace
    where p.isleaf
  `);
  const leaves = new Map(
    leafRows.rows.map(([oid, schema, name]) => [
      String(oid),
      `${String(schema).startsWith('pg_temp_') ? 'pg_temp' : String(schema)}.${String(name)}`,
    ]),
  );
  const keyResult = await prober.run(`select pg_get_partkeydef(${regclass})`);
  const partitionKey = String(keyResult.rows[0]?.[0] ?? '');
  const alias = ident(target.alias);
  const beforeResult = await prober.rows(`
    select ${alias}.tableoid::text, ${alias}.ctid::text, ${alias}.*
    from ${target.sql} as ${alias} order by ${alias}.tableoid, ${alias}.ctid
  `);
  const before = beforeResult.rows.map(([oid, ctid, ...values]) =>
    row(target.alias, `${String(oid)}:${String(ctid)}`, values),
  );
  const run = await tryRun(prober, instrumentPartitionInsert(stmt.ast));
  if (!run.ok) {
    const errorStage: Stage = {
      id: '0:error',
      kind: 'error',
      error: run.error,
      focus: errorFocus(run.error, target, opts.schema),
      caption: captions.error(run.error.code, run.error.message),
      output: { columns: [], rows: [] },
    };
    return {
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [errorStage],
      result: null,
      error: run.error,
    };
  }
  const prefix = 2 + target.columns.length;
  const result = userResult(run.value, prefix);
  if (before.length + run.value.rows.length > (opts.maxRows ?? 2000)) {
    return {
      mode: 'final-only',
      fallbackReason: 'Пока не анимируется: таблица больше лимита строк',
      stages: [],
      result,
      error: null,
    };
  }
  const groups = new Map<string, Row[]>();
  const added: Row[] = [];
  for (const values of run.value.rows) {
    const oid = String(values[0]);
    const partitionId = leaves.get(oid);
    if (!partitionId) {
      return {
        mode: 'final-only',
        fallbackReason: 'Не удалось определить секцию вставленной строки',
        stages: [],
        result,
        error: null,
      };
    }
    const item = row(target.alias, `${oid}:${String(values[1])}`, values.slice(2, prefix));
    added.push(item);
    const group = groups.get(partitionId) ?? [];
    group.push(item);
    groups.set(partitionId, group);
  }
  const routing = [...groups].map(([partitionId, rows]) => ({
    partitionId,
    added: { columns: target.columns, rows } satisfies Relation,
  }));
  const stage: Stage = {
    id: '0:dml',
    kind: 'dml',
    op: 'insert',
    tableId: table.id,
    inserted: added.map((item) => item.key),
    deleted: [],
    updated: [],
    conflicts: [],
    mergeBranches: {},
    cascades: [],
    routing,
    partitionKey,
    caption: captions.dmlInsert(added.length, before.length),
    output: { columns: target.columns, rows: [...before, ...added] },
    sourceRange: { from: stmt.from, to: stmt.to },
  };
  return { mode: 'full', stages: [stage], result, error: null };
}
