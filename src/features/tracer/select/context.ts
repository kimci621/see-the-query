import type { Node, SelectStmt, SortBy } from '@pgsql/types';
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { QueryResult } from '@/features/db/types';
import { clauseRanges } from '@/features/sql/clauses';
import type { ClauseName, ParsedStatement } from '@/features/sql/types';
import { ident, type Prober, sqlOf, TraceFallback, typeNames } from '../probe';
import type { Column, Row, RowKey, SourceRange, Stage } from '../types';
import { canon, rowCanon } from '../verify';
import { hasVolatile } from '../whitelist';
import { alignWindow } from './align';
import { type JoinNode, joinFragment, type Source } from './join';

export interface Output {
  columns: Column[]; // выходные колонки запроса
  kinds: Array<{
    kind: 'kept' | 'renamed' | 'computed';
    column: string | null;
    alias: string | null; // источник колонки
    expr: Node | null;
  }>;
  stable: boolean[]; // false у volatile-колонки: её значения в пробе и в эталоне разные
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
  sources: Source[];
  joins: JoinNode[];
  aliasOrder: string[]; // алиасы источников по порядку, ключ lineage
  sql: {
    rowKey: string; // выражение SQL, дающее RowKey строки
    from: string;
    fromUpTo: (k: number) => string; // FROM до k-го JOIN включительно
    fromSource: (i: number) => string;
    where: string;
    group: string; // ' GROUP BY …' после стадии group, пробы над группами дописывают его после WHERE
    targets: string;
  };
  scanColumns: string[]; // имена колонок всех источников по порядку
  sourceColumns: Column[][]; // колонки каждого источника, их заполняет scan
  // После group: выражения ключей и агрегатов и имена колонок группы (ключи, затем агрегаты)
  grouped: { keys: string[]; aggregates: string[]; columns: string[] } | null;
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
  sources: Source[];
  joins: JoinNode[];
  schema: SchemaSnapshot;
}): SelectCtx {
  const { sel, prober, sources, joins } = args;
  const aliasOrder = sources.map((s) => s.alias);
  const types = new Map<number, string>();
  const fromUpTo = (k: number) =>
    ` FROM ${sqlOf(sources[0].rv)}${joins
      .slice(0, k + 1)
      .map(joinFragment)
      .join('')}`;
  const ctx: SelectCtx = {
    ...args,
    aliasOrder,
    sql: {
      rowKey: rowKeySql(aliasOrder),
      from: fromUpTo(joins.length - 1),
      fromUpTo,
      fromSource: (i) => ` FROM ${sqlOf(sources[i].rv)}`,
      where: sel.whereClause ? ` WHERE ${sqlOf(sel.whereClause)}` : '',
      group: '',
      targets: (sel.targetList ?? []).map(sqlOf).join(', '),
    },
    scanColumns: [],
    sourceColumns: [],
    grouped: null,
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

// RowKey прямо в SQL, как rowKeyOf: 'b=(0,3)|a=∅'
export function rowKeySql(aliases: string[]): string {
  const parts = aliases.map((a, i) => {
    const label = `${i ? '|' : ''}${a}=`.replaceAll("'", "''");
    return `'${label}', coalesce(${ident(a)}.ctid::text, '∅')`;
  });
  return `concat(${parts.join(', ')})`;
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
  const probe = await ctx.prober.run(`SELECT ${ctx.sql.targets}${ctx.sql.from}${ctx.sql.group} LIMIT 0`);
  const types = await ctx.typeNames(probe.fields.map((f) => f.dataTypeID));
  const kinds: Output['kinds'] = [];
  for (const node of ctx.sel.targetList ?? []) {
    const rt = 'ResTarget' in node ? node.ResTarget : {};
    const ref = rt.val && 'ColumnRef' in rt.val ? rt.val.ColumnRef : null;
    const last = ref?.fields?.at(-1);
    const qualifier = ref?.fields?.length === 2 ? ref.fields[0] : undefined;
    const alias = qualifier && 'String' in qualifier ? (qualifier.String.sval ?? null) : null;
    if (last && 'A_Star' in last) {
      // * раскрывается как в Postgres, b.* только в свой источник
      for (const c of alias === null ? starColumns(ctx) : starOf(ctx, alias))
        kinds.push({ kind: 'kept', column: c.column, alias: c.alias, expr: null });
      continue;
    }
    const column = last && 'String' in last ? (last.String.sval ?? null) : null;
    const owner = column === null ? -1 : sourceOf(ctx, alias, column);
    // После group колонка живёт, только если это ключ или агрегат группы
    const { grouped } = ctx;
    const g = grouped ? [...grouped.keys, ...grouped.aggregates].indexOf(rt.val ? sqlOf(rt.val) : '') : -1;
    if (column && owner >= 0 && (!grouped || grouped.columns.slice(0, grouped.keys.length).includes(column)))
      kinds.push({ kind: 'kept', column, alias: ctx.aliasOrder[owner], expr: rt.val ?? null });
    else if (grouped && g >= 0)
      kinds.push({ kind: 'kept', column: grouped.columns[g], alias: null, expr: rt.val ?? null });
    else kinds.push({ kind: 'computed', column: null, alias: null, expr: rt.val ?? null });
  }
  // (t).* и подобное раскрываются в несколько колонок, сопоставить их с целями списка нельзя
  if (kinds.length !== probe.fields.length)
    throw new TraceFallback('Пока не анимируется: такой список SELECT');
  const columns = probe.fields.map((f, i): Column => {
    const k = kinds[i];
    if (k.column && f.name !== k.column) k.kind = 'renamed';
    return {
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
      ...(k.column && k.alias ? { source: { alias: k.alias, column: k.column } } : {}),
    };
  });
  return { columns, kinds, stable: kinds.map((k) => !hasVolatile(k.expr)) };
}

// Индекс источника колонки: по квалификатору или единственный источник с таким именем
export function sourceOf(ctx: SelectCtx, alias: string | null, column: string): number {
  const owners = ctx.sourceColumns.flatMap((cols, i) =>
    (alias === null || ctx.aliasOrder[i] === alias) && cols.some((c) => c.name === column) ? [i] : [],
  );
  if (owners.length === 1) return owners[0];
  // Слитая USING-колонка без квалификатора принадлежит левой стороне
  const merged = alias === null && ctx.joins.some((j) => j.using?.includes(column));
  return merged && owners.length ? owners[0] : -1;
}

type StarColumn = { alias: string; column: string };

function starOf(ctx: SelectCtx, alias: string): StarColumn[] {
  const i = ctx.aliasOrder.indexOf(alias);
  return (ctx.sourceColumns[i] ?? []).map((c) => ({ alias, column: c.name }));
}

// SELECT * над соединением: у USING-узла сначала слитые колонки, потом левые, потом правые без них
function starColumns(ctx: SelectCtx): StarColumn[] {
  let cols = starOf(ctx, ctx.aliasOrder[0]);
  for (const [m, j] of ctx.joins.entries()) {
    const right = starOf(ctx, ctx.aliasOrder[m + 1]);
    const using = j.using ?? [];
    const merged = using.flatMap((name) => cols.find((c) => c.column === name) ?? []);
    const rest = (c: StarColumn) => !using.includes(c.column);
    cols = [...merged, ...cols.filter(rest), ...right.filter(rest)];
  }
  return cols;
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
      if (!out.stable[idx]) leading = false;
      if (leading) orderKeys.push(idx);
    } else {
      // Выражение считается один раз в той же пробе: random() даёт согласованный порядок
      extra.push(`(${sb.node ? sqlOf(sb.node) : 'NULL'}) AS __vs_k${i}`);
      orderParts.push(`__vs_k${i}${dir}${nulls}`);
      tupleIdx.push(n + extra.length); // после колонок SELECT идёт ключ строки, затем выражения
      leading = false;
    }
  }
  // ctid (у групп ключи группы) последним ключом: порядок равных строк детерминирован
  orderParts.push(...(ctx.grouped?.keys ?? ctx.aliasOrder.map((a) => `${ident(a)}.ctid`)));
  const extraSql = extra.map((e) => `, ${e}`).join('');
  const orderSql = orderParts.length ? ` ORDER BY ${orderParts.join(', ')}` : '';
  const r = await ctx.prober.rows(
    `SELECT ${ctx.sql.targets}, ${ctx.sql.rowKey} AS __vs_key${extraSql}${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}${orderSql}`,
  );
  const order: RowKey[] = [];
  const values = new Map<RowKey, unknown[]>();
  const tuple = new Map<RowKey, string>();
  for (const row of r.rows) {
    const key = row[n] as RowKey;
    // Повтор ctid: функция в SELECT размножила строку, lineage неоднозначен
    if (values.has(key))
      throw new TraceFallback('Пока не анимируется: функция, возвращающая несколько строк');
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

// Канон строки без volatile-колонок: сверка и выравнивание только по тому, что совпадает с эталоном
export function stableCanon(out: Output): (values: unknown[]) => string {
  return (values) => rowCanon(values.filter((_, i) => out.stable[i]));
}

// Равные по ключам строки на границе окна выбираем так же, как выбрал Postgres в эталоне
export async function alignToReference(ctx: SelectCtx, keys: RowKey[]): Promise<RowKey[]> {
  const ordered = await ctx.ordered();
  const canonOf = stableCanon(await ctx.outputs());
  const { from, to } = await windowOf(ctx, keys);
  return alignWindow(
    keys,
    (k) => (ctx.sel.sortClause ? (ordered.tuple.get(k) ?? '') : ''),
    (k) => canonOf(ordered.values.get(k) ?? []),
    ctx.reference.rows.map(canonOf),
    from,
    to,
  );
}
