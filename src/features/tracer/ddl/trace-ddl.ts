import { introspect } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { keyOf, resolveTarget, tryRun } from '../dml/shared';
import { ident, type Prober, sqlOf } from '../probe';
import type { Special } from '../route';
import type { Stage, TraceOptions } from '../types';
import { diffSchemas, type Renames } from './diff';

function renamesOf(stmt: ParsedStatement, schema: TraceOptions['schema']): Renames {
  const body = (
    stmt.ast as unknown as {
      RenameStmt?: {
        relation?: { relname?: string; schemaname?: string };
        subname?: string;
        newname?: string;
      };
    }
  ).RenameStmt;
  if (!body?.relation?.relname || !body.newname) return { columns: [], tables: [] };
  const table = schema.tables.find(
    (item) => item.name === body.relation?.relname && item.schema === (body.relation.schemaname ?? 'public'),
  );
  if (!table) return { columns: [], tables: [] };
  if (body.subname)
    return { columns: [{ tableId: table.id, from: body.subname, to: body.newname }], tables: [] };
  return { columns: [], tables: [{ from: table.id, to: `${table.schema}.${body.newname}` }] };
}

async function checkViolations(stmt: ParsedStatement, prober: Prober, opts: TraceOptions): Promise<string[]> {
  const body = (
    stmt.ast as unknown as {
      AlterTableStmt?: {
        relation?: { relname: string; schemaname?: string };
        cmds?: Array<{
          AlterTableCmd?: {
            subtype?: string;
            name?: string;
            def?: {
              Constraint?: {
                contype?: string;
                raw_expr?: unknown;
                keys?: Array<{ String?: { sval?: string } }>;
              };
            };
          };
        }>;
      };
    }
  ).AlterTableStmt;
  const command = body?.cmds?.[0]?.AlterTableCmd;
  if (!command || !body?.relation) return [];
  const target = resolveTarget(opts.schema, body.relation);
  if (!target) return [];
  const alias = ident(target.alias);
  const constraint = command.def?.Constraint;
  let sql: string | null = null;
  if (constraint?.contype === 'CONSTR_CHECK' && constraint.raw_expr)
    sql = `SELECT ${alias}.ctid::text FROM ${target.sql} AS ${alias} WHERE NOT (${sqlOf(constraint.raw_expr as never)}) ORDER BY ${alias}.ctid`;
  if (constraint?.contype === 'CONSTR_UNIQUE') {
    const columns = (constraint.keys ?? []).flatMap((item) => (item.String?.sval ? [item.String.sval] : []));
    const names = columns.map((column) => `${alias}.${ident(column)}`);
    if (names.length)
      sql = `SELECT ${alias}.ctid::text FROM ${target.sql} AS ${alias} WHERE (${names.join(', ')}) IN (SELECT ${columns.map(ident).join(', ')} FROM ${target.sql} GROUP BY ${columns.map(ident).join(', ')} HAVING count(*) > 1) ORDER BY ${alias}.ctid`;
  }
  if (command.subtype === 'AT_SetNotNull' && command.name)
    sql = `SELECT ${alias}.ctid::text FROM ${target.sql} AS ${alias} WHERE ${alias}.${ident(command.name)} IS NULL ORDER BY ${alias}.ctid`;
  if (!sql) return [];
  const run = await tryRun(prober, sql);
  return run.ok ? run.value.rows.map(([ctid]) => keyOf(target.alias, ctid as string)) : [];
}

export async function traceDdl(
  stmt: ParsedStatement,
  db: DbClient,
  prober: Prober,
  opts: TraceOptions,
): Promise<Special> {
  const conflictKeys = await checkViolations(stmt, prober, opts);
  const run = await tryRun(prober, stmt.text);
  if (!run.ok) {
    const stage: Stage = {
      id: '0:error',
      kind: 'error',
      error: run.error,
      focus: { tableIds: [], columns: [] },
      caption: captions.error(run.error.code, run.error.message),
      output: { columns: [], rows: [] },
      ...(conflictKeys.length ? { conflictKeys } : {}),
    };
    return {
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [stage],
      result: null,
      error: run.error,
    };
  }
  const diff = diffSchemas(opts.schema, await introspect(db), renamesOf(stmt, opts.schema));
  return {
    mode: 'full',
    stages: [
      {
        id: '0:ddl',
        kind: 'ddl',
        diff,
        caption: captions.ddl(),
        output: { columns: [], rows: [] },
        sourceRange: { from: stmt.from, to: stmt.to },
      },
    ],
    result: run.value,
    error: null,
  };
}
