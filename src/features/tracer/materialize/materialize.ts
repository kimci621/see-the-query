import type { JoinExpr, Node, SelectStmt } from '@pgsql/types';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { ident, type Prober, sqlOf, typeNames } from '../probe';
import { prepareRecursive } from '../recursion/recursion';
import type { Stage, Trace, TraceOptions } from '../types';
import { replaceRangeVars } from './replace';

export type TraceFn = (stmt: ParsedStatement, db: DbClient, opts: TraceOptions) => Promise<Trace>;

let sequence = 0;

export function materializeStage(name: string, inner: Trace, id: string): Stage & { kind: 'materialize' } {
  const last = inner.stages.at(-1);
  const output = last?.output ?? { columns: [], rows: [] };
  return {
    id,
    kind: 'materialize',
    name,
    inner,
    caption: captions.materialize(name, output.rows.length),
    output,
    ...(last?.rowCount !== undefined ? { rowCount: last.rowCount } : {}),
  };
}

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

async function tempTable(prober: Prober, name: string, types: Map<number, string>): Promise<TableInfo> {
  const probe = await prober.run(`SELECT * FROM ${ident(name)} LIMIT 0`);
  const names = await typeNames(
    prober,
    probe.fields.map((f) => f.dataTypeID),
    types,
  );
  const count = await prober.run(`SELECT count(*)::int FROM ${ident(name)}`);
  return {
    id: `pg_temp.${name}`,
    schema: 'pg_temp',
    name,
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

export interface PreparedSources {
  sel: SelectStmt;
  schema: SchemaSnapshot;
  stages: Stage[];
}

function hasFromSubquery(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasFromSubquery);
  if (!node || typeof node !== 'object') return false;
  if ('RangeSubselect' in node) return true;
  return Object.values(node).some(hasFromSubquery);
}

// CTE и подзапросы в FROM материализуем в TEMP-таблицы: дальше обычный SELECT читает их как источники.
// NOT MATERIALIZED пока не инлайнится: final-only не покажет ложную материализацию.
export async function prepareSources(
  stmt: ParsedStatement,
  sel: SelectStmt,
  db: DbClient,
  prober: Prober,
  opts: TraceOptions,
  trace: TraceFn,
): Promise<PreparedSources | { reason: string }> {
  const ctes = (sel.withClause?.ctes ?? []).flatMap((node) =>
    'CommonTableExpr' in node ? [node.CommonTableExpr] : [],
  );
  if (sel.withClause?.recursive) {
    if (ctes.length !== 1) return { reason: 'Рекурсивный CTE вместе с другими CTE пока не анимируется' };
    const recursion = await prepareRecursive(ctes[0], opts.schema, prober);
    if ('reason' in recursion) return { reason: recursion.reason };
    const rewritten = replaceRangeVars(
      { ...sel, withClause: undefined },
      new Map([[recursion.name, recursion.temp]]),
    ) as SelectStmt;
    if (hasFromSubquery(rewritten.fromClause))
      return { reason: 'Рекурсивный CTE с подзапросом в FROM пока не анимируется' };
    return { sel: rewritten, schema: recursion.schema, stages: [recursion.stage] };
  }
  let schema = opts.schema;
  const names = new Map<string, string>();
  const stages: Stage[] = [];
  const types = new Map<number, string>();
  if (!ctes.length && !hasFromSubquery(sel.fromClause)) return { sel, schema, stages };
  for (const cte of ctes) {
    const name = cte.ctename;
    if (!name) return { reason: 'CTE без имени не анимируется' };
    if (cte.ctematerialized === 'CTEMaterializeNever')
      return { reason: `CTE ${name} с NOT MATERIALIZED пока не анимируется` };
    if (!cte.ctequery || !('SelectStmt' in cte.ctequery))
      return { reason: `CTE ${name}: тело не SELECT, пока не анимируется` };
    const body = replaceRangeVars(cte.ctequery, names) as Node;
    const temp = `__vs_m${sequence++}`;
    await prober.run(`CREATE TEMP TABLE ${ident(temp)} AS ${sqlOf(body)}`);
    const table = await tempTable(prober, temp, types);
    schema = { ...schema, tables: [...schema.tables, table] };
    const branch: ParsedStatement = {
      index: stmt.index,
      from: stmt.from,
      to: stmt.to,
      byteFrom: stmt.byteFrom,
      text: sqlOf(body),
      ast: body,
      kind: 'select',
    };
    const inner = await trace(branch, db, { ...opts, schema });
    if (inner.mode !== 'full')
      return { reason: `CTE ${name} не анимируется: ${inner.fallbackReason ?? 'причина не указана'}` };
    stages.push(materializeStage(name, inner, `${stages.length}:materialize`));
    names.set(name, temp);
  }
  let rewritten = replaceRangeVars({ ...sel, withClause: undefined }, names) as SelectStmt;
  if (!hasFromSubquery(rewritten.fromClause)) return { sel: rewritten, schema, stages };
  let failure: string | null = null;
  const rewriteFrom = async (node: Node): Promise<Node> => {
    if ('JoinExpr' in node) {
      const je = node.JoinExpr;
      const larg = je.larg ? await rewriteFrom(je.larg) : undefined;
      const rarg = je.rarg ? await rewriteFrom(je.rarg) : undefined;
      return { JoinExpr: { ...je, ...(larg ? { larg } : {}), ...(rarg ? { rarg } : {}) } as JoinExpr };
    }
    if (!('RangeSubselect' in node)) return node;
    const rs = node.RangeSubselect;
    if (!rs.subquery || !('SelectStmt' in rs.subquery)) {
      failure = 'Подзапрос в FROM без SELECT пока не анимируется';
      return node;
    }
    const alias = rs.alias?.aliasname ?? `__vs_from${stages.length}`;
    const temp = `__vs_f${sequence++}`;
    await prober.run(`CREATE TEMP TABLE ${ident(temp)} AS ${sqlOf(rs.subquery)}`);
    const table = await tempTable(prober, temp, types);
    schema = { ...schema, tables: [...schema.tables, table] };
    const body = rs.subquery;
    const branch: ParsedStatement = {
      index: stmt.index,
      from: stmt.from,
      to: stmt.to,
      byteFrom: stmt.byteFrom,
      text: sqlOf(body),
      ast: body,
      kind: 'select',
    };
    const inner = await trace(branch, db, { ...opts, schema });
    if (inner.mode !== 'full') {
      failure = `Подзапрос ${alias} не анимируется: ${inner.fallbackReason ?? 'причина не указана'}`;
      return node;
    }
    stages.push(materializeStage(alias, inner, `${stages.length}:materialize`));
    return {
      RangeVar: {
        schemaname: 'pg_temp',
        relname: temp,
        alias: rs.alias ?? { aliasname: alias },
      },
    };
  };
  const items: Node[] = [];
  for (const item of rewritten.fromClause ?? []) items.push(await rewriteFrom(item));
  if (failure) return { reason: failure };
  rewritten = { ...rewritten, fromClause: items };
  return { sel: rewritten, schema, stages };
}
