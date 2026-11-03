import type { Node, SelectStmt } from '@pgsql/types';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { rowsWord } from '@/lib/plural';
import { replaceRangeVars } from '../materialize/replace';
import { ident, type Prober, sqlOf, typeNames } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Relation, Stage } from '../types';
import { hasVolatile } from '../whitelist';

let sequence = 0;

function columnInfo(name: string, type: string): ColumnInfo {
  return {
    name,
    type,
    nullable: true,
    default: null,
    isPk: false,
    isUnique: false,
    isGenerated: false,
    identity: null,
    checks: [],
    fk: null,
  };
}

async function relationOf(
  prober: Prober,
  temp: string,
  alias: string,
  types: Map<number, string>,
): Promise<Relation> {
  const r = await prober.rows(`SELECT ctid::text, * FROM ${ident(temp)} ORDER BY ctid`);
  const fields = r.fields.slice(1);
  const names = await typeNames(
    prober,
    fields.map((f) => f.dataTypeID),
    types,
  );
  return {
    columns: fields.map((f) => ({
      name: f.name,
      type: names.get(f.dataTypeID) ?? 'unknown',
      source: { alias, column: f.name },
    })),
    rows: r.rows.map((row) => ({
      key: rowKeyOf({ [alias]: row[0] as string }, [alias]),
      lineage: { [alias]: row[0] as string },
      values: row.slice(1),
    })),
  };
}

async function tempTable(prober: Prober, temp: string, types: Map<number, string>): Promise<TableInfo> {
  const probe = await prober.run(`SELECT * FROM ${ident(temp)} LIMIT 0`);
  const names = await typeNames(
    prober,
    probe.fields.map((f) => f.dataTypeID),
    types,
  );
  const count = await prober.run(`SELECT count(*)::int FROM ${ident(temp)}`);
  return {
    id: `pg_temp.${temp}`,
    schema: 'pg_temp',
    name: temp,
    kind: 'temp',
    columns: probe.fields.map((f) => columnInfo(f.name, names.get(f.dataTypeID) ?? 'unknown')),
    rowCount: Number(count.rows[0]?.[0] ?? 0),
    sampleRows: [],
    sampleCtids: [],
    indexes: [],
    constraints: [],
    comment: null,
  };
}

export interface RecursionResult {
  name: string;
  temp: string;
  schema: SchemaSnapshot;
  stage: Stage & { kind: 'recursion' };
  rows: number;
}

// WITH RECURSIVE: якорь и шаг выполняем по итерациям через TEMP-таблицы.
// UNION схлопывает повторы, UNION ALL оставляет все; итог сверяется с эталоном снаружи.
export async function prepareRecursive(
  cte: { ctename?: string; ctequery?: Node; aliascolnames?: Node[] },
  schema: SchemaSnapshot,
  prober: Prober,
): Promise<RecursionResult | { reason: string }> {
  const name = cte.ctename;
  if (!name) return { reason: 'Рекурсивный CTE без имени не анимируется' };
  if (!cte.ctequery || !('SelectStmt' in cte.ctequery))
    return { reason: 'Рекурсивный CTE без SELECT пока не анимируется' };
  const body = cte.ctequery.SelectStmt as SelectStmt;
  if (body.op !== 'SETOP_UNION' || !body.larg || !body.rarg)
    return { reason: 'Рекурсивный CTE поддерживает только UNION / UNION ALL' };
  if (hasVolatile(body.larg) || hasVolatile(body.rarg))
    return { reason: 'Рекурсивный CTE с volatile-функцией не анимируется' };
  const all = Boolean(body.all);
  const aliases = (cte.aliascolnames ?? []).flatMap((node) =>
    'String' in node ? [node.String.sval ?? ''] : [],
  );
  const anchorSql = sqlOf({ SelectStmt: body.larg });
  const anchor = aliases.length
    ? `SELECT * FROM (${anchorSql}) AS __vs_a(${aliases.map(ident).join(', ')})`
    : anchorSql;
  const types = new Map<number, string>();
  let current = `__vs_r${sequence++}`;
  await prober.run(`CREATE TEMP TABLE ${ident(current)} AS ${anchor}`);
  const anchorRelation = await relationOf(prober, current, name, types);
  // Шаг читает только строки прошлой итерации: накопленную таблицу он не видит, как в Postgres
  let working = current;
  let stopped = false;
  const iterations: Relation[] = [anchorRelation];
  for (let stepIndex = 0; stepIndex < 50; stepIndex++) {
    const stepAst = {
      SelectStmt: replaceRangeVars(body.rarg, new Map([[name, working]])),
    } as Node;
    const stepTemp = `__vs_s${sequence++}`;
    await prober.run(`CREATE TEMP TABLE ${ident(stepTemp)} AS ${sqlOf(stepAst)}`);
    const next = `__vs_r${sequence++}`;
    await prober.run(
      `CREATE TEMP TABLE ${ident(next)} AS SELECT * FROM ${ident(current)} UNION ${all ? 'ALL ' : ''}SELECT * FROM ${ident(stepTemp)}`,
    );
    const fresh = `__vs_w${sequence++}`;
    const columns = anchorRelation.columns.map((column) => ident(column.name)).join(', ');
    await prober.run(
      all
        ? `CREATE TEMP TABLE ${ident(fresh)} AS SELECT * FROM ${ident(stepTemp)} AS __vs_w(${columns})`
        : `CREATE TEMP TABLE ${ident(fresh)} AS SELECT * FROM (SELECT * FROM ${ident(stepTemp)} EXCEPT SELECT * FROM ${ident(current)}) AS __vs_w(${columns})`,
    );
    working = fresh;
    const workingRelation = await relationOf(prober, working, name, types);
    iterations.push(workingRelation);
    current = next;
    if (!workingRelation.rows.length) {
      stopped = true;
      break;
    }
  }
  if (!stopped) return { reason: 'Рекурсия глубже 50 итераций' };
  const final = await relationOf(prober, current, name, types);
  const table = await tempTable(prober, current, types);
  const nextSchema = { ...schema, tables: [...schema.tables, table] };
  const stage: Stage & { kind: 'recursion' } = {
    id: '0:recursion',
    kind: 'recursion',
    name,
    iterations,
    caption: `WITH RECURSIVE ${name}: ${iterations.length} итераций, ${rowsWord(final.rows.length)}`,
    output: final,
  };
  return { name, temp: current, schema: nextSchema, stage, rows: final.rows.length };
}
