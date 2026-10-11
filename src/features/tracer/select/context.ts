import type { Node, SelectStmt, SortBy } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import type { QueryResult } from '@/features/db/types';
import { clauseRanges } from '@/features/sql/clauses';
import type { ClauseName, ParsedStatement } from '@/features/sql/types';
import { ident, type Prober, sqlOf, typeNames } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Column, Row, RowKey, SourceRange, Stage } from '../types';
import { canon, rowCanon } from '../verify';
import { alignWindow } from './align';

export interface Output {
  columns: Column[]; // выходные колонки запроса
  kinds: Array<{ kind: 'kept' | 'renamed' | 'computed'; column: string | null; expr: Node | null }>;
}

// Упорядоченная проекция P: одна проба даёт значения SELECT, порядок ORDER BY и значения ключей
export interface Ordered {
  order: RowKey[];
  values: Map<RowKey, unknown[]>;
  tuple: Map<RowKey, string>; // канон ключей сортировки строки
  sortKeys: string[];
  orderKeys: number[] | null; // выходные колонки-ключи (ведущие) для сверки порядка
}

export interface LimitParams {
  limit: number | null;
  offset: number;
  withTies: boolean;
}

export interface SelectCtx {
  stmt: ParsedStatement;
  sel: SelectStmt;
  prober: Prober;
  reference: QueryResult;
  volatile: boolean;
  table: TableInfo;
  alias: string; // алиас или имя таблицы, ключ lineage
  sql: { alias: string; lineage: string; from: string; where: string; targets: string };
  scanColumns: string[];
  columns: Column[];
  rows: Row[];
  stages: Stage[];
  outputs: () => Promise<Output>;
  ordered: () => Promise<Ordered>;
  limitParams: () => Promise<LimitParams>;
  typeNames: (oids: number[]) => Promise<Map<number, string>>;
}

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= fn();
    return p;
  };
}

export function createSelectCtx(args: {
  stmt: ParsedStatement;
  sel: SelectStmt;
  prober: Prober;
  reference: QueryResult;
  volatile: boolean;
  table: TableInfo;
  schema: SchemaSnapshot;
}): SelectCtx {
  const { sel, prober } = args;
  const rv = sel.fromClause?.[0];
  const alias = rv && 'RangeVar' in rv ? (rv.RangeVar.alias?.aliasname ?? rv.RangeVar.relname ?? '') : '';
  const a = ident(alias);
  const types = new Map<number, string>();
  const ctx: SelectCtx = {
    ...args,
    alias,
    sql: {
      alias: a,
      lineage: `${a}.ctid::text AS __vs_l0`,
      from: rv ? ` FROM ${sqlOf(rv)}` : '',
      where: sel.whereClause ? ` WHERE ${sqlOf(sel.whereClause)}` : '',
      targets: (sel.targetList ?? []).map(sqlOf).join(', '),
    },
    scanColumns: [],
    columns: [],
    rows: [],
    stages: [],
    typeNames: (oids) => typeNames(prober, oids, types),
    outputs: once(() => loadOutputs(ctx)),
    ordered: once(() => loadOrdered(ctx)),
    limitParams: once(() => loadLimitParams(ctx)),
  };
  return ctx;
}

export function keyOf(ctx: SelectCtx, ctid: string): RowKey {
  return rowKeyOf({ [ctx.alias]: ctid }, [ctx.alias]);
}

export function stageId(ctx: SelectCtx, kind: Stage['kind']): string {
  return `${ctx.stages.length}:${kind}`;
}

// Диапазон в редакторе: объединение нужных клауз
export function rangeOf(stmt: ParsedStatement, ...clauses: ClauseName[]): SourceRange | undefined {
  const found = clauseRanges(stmt).filter((r) => clauses.includes(r.clause));
  if (!found.length) return undefined;
  return { from: Math.min(...found.map((r) => r.from)), to: Math.max(...found.map((r) => r.to)) };
}

async function loadOutputs(ctx: SelectCtx): Promise<Output> {
  // Имена и типы выходных колонок отдаёт сам Postgres: звёздочки, неявные имена вроде upper, ?column?
  const probe = await ctx.prober.run(`SELECT ${ctx.sql.targets}${ctx.sql.from} LIMIT 0`);
  const types = await ctx.typeNames(probe.fields.map((f) => f.dataTypeID));
  const kinds: Output['kinds'] = [];
  for (const node of ctx.sel.targetList ?? []) {
    const rt = 'ResTarget' in node ? node.ResTarget : {};
    const ref = rt.val && 'ColumnRef' in rt.val ? rt.val.ColumnRef : null;
    const last = ref?.fields?.at(-1);
    if (last && 'A_Star' in last) {
      for (const column of ctx.scanColumns) kinds.push({ kind: 'kept', column, expr: null });
      continue;
    }
    const column = last && 'String' in last ? (last.String.sval ?? null) : null;
    if (column && ctx.scanColumns.includes(column))
      kinds.push({ kind: 'kept', column, expr: rt.val ?? null });
    else kinds.push({ kind: 'computed', column: null, expr: rt.val ?? null });
  }
  const columns = probe.fields.map((f, i): Column => {
    const k = kinds[i];
    if (k.column && f.name !== k.column) k.kind = 'renamed';
    return {
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
      ...(k.column ? { source: { alias: ctx.alias, column: k.column } } : {}),
    };
  });
  return { columns, kinds };
}

// Ключ ORDER BY / DISTINCT ON → индекс выходной колонки (номер или имя выхода) или null (выражение над входом)
export function outputIndex(node: Node, out: Output): number | null {
  if ('A_Const' in node && node.A_Const.ival) return (node.A_Const.ival.ival ?? 0) - 1;
  const fields = 'ColumnRef' in node ? node.ColumnRef.fields : undefined;
  if (fields?.length === 1 && 'String' in fields[0]) {
    const i = out.columns.findIndex(
      (c) => c.name === (fields[0] as { String: { sval?: string } }).String.sval,
    );
    if (i >= 0) return i;
  }
  return null;
}

async function loadOrdered(ctx: SelectCtx): Promise<Ordered> {
  const out = await ctx.outputs();
  const n = out.columns.length;
  const extra: string[] = [];
  const orderParts: string[] = [];
  const tupleIdx: number[] = [];
  const orderKeys: number[] = [];
  let leading = true;
  for (const [i, node] of (ctx.sel.sortClause ?? []).entries()) {
    const sb: SortBy = 'SortBy' in node ? node.SortBy : {};
    const dir = sb.sortby_dir === 'SORTBY_DESC' ? ' DESC' : sb.sortby_dir === 'SORTBY_ASC' ? ' ASC' : '';
    const nulls =
      sb.sortby_nulls === 'SORTBY_NULLS_FIRST'
        ? ' NULLS FIRST'
        : sb.sortby_nulls === 'SORTBY_NULLS_LAST'
          ? ' NULLS LAST'
          : '';
    const idx = sb.node ? outputIndex(sb.node, out) : null;
    if (idx !== null) {
      orderParts.push(`${idx + 1}${dir}${nulls}`);
      tupleIdx.push(idx);
      if (leading) orderKeys.push(idx);
    } else {
      // Выражение считается один раз в той же пробе: random() даёт согласованный порядок
      extra.push(`(${sb.node ? sqlOf(sb.node) : 'NULL'}) AS __vs_k${i}`);
      orderParts.push(`__vs_k${i}${dir}${nulls}`);
      tupleIdx.push(n + extra.length);
      leading = false;
    }
  }
  // ctid последним ключом: порядок равных строк детерминирован
  orderParts.push(`${ctx.sql.alias}.ctid`);
  const extraSql = extra.map((e) => `, ${e}`).join('');
  const r = await ctx.prober.rows(
    `SELECT ${ctx.sql.targets}, ${ctx.sql.lineage}${extraSql}${ctx.sql.from}${ctx.sql.where} ORDER BY ${orderParts.join(', ')}`,
  );
  const order: RowKey[] = [];
  const values = new Map<RowKey, unknown[]>();
  const tuple = new Map<RowKey, string>();
  for (const row of r.rows) {
    const key = keyOf(ctx, row[n] as string);
    order.push(key);
    values.set(key, row.slice(0, n));
    tuple.set(key, tupleIdx.map((i) => canon(row[i])).join('\u0002'));
  }
  return {
    order,
    values,
    tuple,
    sortKeys: (ctx.sel.sortClause ?? []).map(sqlOf),
    orderKeys: orderKeys.length ? orderKeys : null,
  };
}

async function loadLimitParams(ctx: SelectCtx): Promise<LimitParams> {
  const { limitCount, limitOffset, limitOption } = ctx.sel;
  // Выражения LIMIT/OFFSET вычисляет Postgres; LIMIT ALL и LIMIT NULL дают NULL
  const r = await ctx.prober.run(
    `SELECT (${limitCount ? sqlOf(limitCount) : 'NULL'})::int8, (${limitOffset ? sqlOf(limitOffset) : '0'})::int8`,
  );
  const [limit, offset] = r.rows[0];
  return {
    limit: limit === null ? null : Number(limit),
    offset: Number(offset ?? 0),
    withTies: limitOption === 'LIMIT_OPTION_WITH_TIES',
  };
}

// Окно LIMIT/OFFSET над упорядоченными ключами; WITH TIES тянет конец по равным ключам
export async function windowOf(ctx: SelectCtx, keys: RowKey[]): Promise<{ from: number; to: number }> {
  const { limit, offset, withTies } = await ctx.limitParams();
  const ordered = await ctx.ordered();
  const from = Math.min(offset, keys.length);
  let to = limit === null ? keys.length : Math.min(keys.length, offset + limit);
  if (withTies && to > from) {
    const last = ordered.tuple.get(keys[to - 1]);
    while (to < keys.length && ordered.tuple.get(keys[to]) === last) to++;
  }
  return { from, to };
}

// Равные по ключам строки на границе окна выбираем так же, как выбрал Postgres в эталоне
export async function alignToReference(ctx: SelectCtx, keys: RowKey[]): Promise<RowKey[]> {
  if (ctx.volatile) return keys;
  const ordered = await ctx.ordered();
  const { from, to } = await windowOf(ctx, keys);
  return alignWindow(
    keys,
    (k) => (ctx.sel.sortClause ? (ordered.tuple.get(k) ?? '') : ''),
    (k) => rowCanon(ordered.values.get(k) ?? []),
    ctx.reference.rows.map(rowCanon),
    from,
    to,
  );
}
