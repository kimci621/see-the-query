import type { FuncCall, JoinExpr, Node, SelectStmt } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import type { ParsedStatement, StatementKind } from '@/features/sql/types';

// Функции, которые при повторном вызове дают другое значение или меняют состояние
export const VOLATILE = new Set([
  'random',
  'random_normal',
  'setseed',
  'clock_timestamp',
  'timeofday',
  'nextval',
  'setval',
  'currval',
  'lastval',
  'gen_random_uuid',
  'uuidv4',
  'uuidv7',
  'pg_sleep',
  'txid_current',
]);

// Агрегаты без GROUP BY тоже сворачивают строки, это работа Ф7
export const AGGREGATES = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'array_agg',
  'string_agg',
  'json_agg',
  'jsonb_agg',
  'json_object_agg',
  'jsonb_object_agg',
  'bool_and',
  'bool_or',
  'every',
  'bit_and',
  'bit_or',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'percentile_cont',
  'percentile_disc',
  'mode',
  'corr',
  'covar_pop',
  'covar_samp',
  'regr_slope',
  'xmlagg',
  'range_agg',
]);

export type Feature =
  | 'select'
  | 'no-from'
  | 'no-from-clauses'
  | 'where'
  | 'distinct'
  | 'distinct-on'
  | 'order'
  | 'limit'
  | 'volatile'
  | 'volatile-other'
  | 'volatile-order-limit'
  | 'join'
  | 'join-right'
  | 'join-full'
  | 'join-cross'
  | 'subquery'
  | 'function-from'
  | 'other-from'
  | 'group'
  | 'having'
  | 'aggregate'
  | 'window'
  | 'setop'
  | 'cte'
  | 'values'
  | 'into'
  | 'locking'
  | 'order-using';

// Ф7 и Ф10 расширяют этот набор вместе с шагами в select/pipeline.ts
export const SUPPORTED = new Set<Feature>([
  'select',
  'no-from',
  'where',
  'distinct',
  'distinct-on',
  'order',
  'limit',
  'volatile',
  'join',
  'join-right',
  'join-full',
  'join-cross',
]);

const FEATURE_LABELS: Record<Feature, string> = {
  select: 'SELECT',
  'no-from': 'SELECT без FROM',
  'no-from-clauses': 'WHERE, ORDER BY или LIMIT без FROM',
  where: 'WHERE',
  distinct: 'DISTINCT',
  'distinct-on': 'DISTINCT ON',
  order: 'ORDER BY',
  limit: 'LIMIT',
  volatile: 'volatile-функции',
  'volatile-other': 'volatile-функция в WHERE, DISTINCT или LIMIT',
  'volatile-order-limit': 'volatile-функция в ORDER BY вместе с LIMIT или OFFSET',
  join: 'JOIN',
  'join-right': 'RIGHT JOIN',
  'join-full': 'FULL JOIN',
  'join-cross': 'CROSS JOIN',
  subquery: 'подзапрос',
  'function-from': 'функция в FROM',
  'other-from': 'сложный FROM',
  group: 'GROUP BY',
  having: 'HAVING',
  aggregate: 'агрегатные функции',
  window: 'оконные функции',
  setop: 'UNION / INTERSECT / EXCEPT',
  cte: 'WITH',
  values: 'VALUES',
  into: 'SELECT INTO',
  locking: 'FOR UPDATE',
  'order-using': 'ORDER BY ... USING',
};

const KIND_LABELS: Record<StatementKind, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  merge: 'MERGE',
  ddl: 'изменение схемы',
  tcl: 'команды транзакций',
  other: 'этот оператор',
};

// Обход AST: fn видит каждое поле каждого узла
export function walk(node: unknown, fn: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, fn);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      fn(key, value);
      walk(value, fn);
    }
  }
}

export function funcName(fc: FuncCall): string {
  const last = fc.funcname?.at(-1);
  return last && 'String' in last ? (last.String.sval ?? '') : '';
}

export function hasVolatile(node: unknown): boolean {
  let found = false;
  walk(node, (key, value) => {
    if (key === 'FuncCall' && VOLATILE.has(funcName(value as FuncCall))) found = true;
  });
  return found;
}

export function selectFeatures(sel: SelectStmt): Set<Feature> {
  const f = new Set<Feature>(['select']);
  if (sel.op && sel.op !== 'SETOP_NONE') f.add('setop');
  if (sel.withClause) f.add('cte');
  if (sel.intoClause) f.add('into');
  if (sel.valuesLists) f.add('values');
  if (sel.lockingClause) f.add('locking');
  if (sel.groupClause) f.add('group');
  if (sel.havingClause) f.add('having');
  if (sel.windowClause) f.add('window');
  if (!sel.fromClause) {
    f.add('no-from');
    if (sel.whereClause || sel.distinctClause || sel.sortClause || sel.limitCount || sel.limitOffset)
      f.add('no-from-clauses');
  } else if (sel.fromClause.length > 1) f.add('join-cross');
  for (const item of sel.fromClause ?? []) {
    if ('JoinExpr' in item) joinFeatures(item, f);
    else if ('RangeSubselect' in item) f.add('subquery');
    else if ('RangeFunction' in item) f.add('function-from');
    else if (!('RangeVar' in item)) f.add('other-from');
  }
  if (sel.whereClause) f.add('where');
  if (sel.distinctClause) f.add(Object.keys(sel.distinctClause[0]).length ? 'distinct-on' : 'distinct');
  if (sel.sortClause) f.add('order');
  if (sel.sortClause?.some((n) => 'SortBy' in n && n.SortBy.sortby_dir === 'SORTBY_USING'))
    f.add('order-using');
  if (sel.limitCount || sel.limitOffset) f.add('limit');
  walk(
    [sel.targetList, sel.whereClause, sel.sortClause, sel.distinctClause, sel.limitCount, sel.limitOffset],
    (key, value) => {
      if (key === 'SubLink') f.add('subquery');
      if (key === 'FuncCall') {
        const fc = value as FuncCall;
        if (fc.over) f.add('window');
        else if (fc.agg_star || AGGREGATES.has(funcName(fc))) f.add('aggregate');
      }
    },
  );
  // Volatile допустим только в SELECT и ORDER BY: там его считает одна проба
  if (hasVolatile([sel.targetList, sel.sortClause])) f.add('volatile');
  if (hasVolatile([sel.whereClause, sel.distinctClause, sel.limitCount, sel.limitOffset]))
    f.add('volatile-other');
  if (f.has('volatile') && (f.has('distinct') || f.has('distinct-on'))) f.add('volatile-other');
  // Окно над случайным порядком выбирает другие строки, чем эталон
  if (f.has('limit') && volatileSort(sel)) f.add('volatile-order-limit');
  return f;
}

// Виды соединений по всему дереву FROM; что внутри - разбирает flattenFrom
function joinFeatures(node: Node, f: Set<Feature>): void {
  walk(node, (key, value) => {
    if (key !== 'JoinExpr') return;
    const je = value as JoinExpr;
    if (je.jointype === 'JOIN_RIGHT') f.add('join-right');
    else if (je.jointype === 'JOIN_FULL') f.add('join-full');
    else if (je.jointype === 'JOIN_INNER' && !je.quals && !je.usingClause && !je.isNatural)
      f.add('join-cross');
    else f.add('join');
  });
}

// Ключ ORDER BY volatile сам или ссылается на volatile-колонку выхода по имени или номеру
function volatileSort(sel: SelectStmt): boolean {
  const targets = (sel.targetList ?? []).map((n) => ('ResTarget' in n ? n.ResTarget : {}));
  return (sel.sortClause ?? []).some((n) => {
    const key = 'SortBy' in n ? n.SortBy.node : undefined;
    if (!key) return false;
    if (hasVolatile(key)) return true;
    if ('A_Const' in key && key.A_Const.ival)
      return hasVolatile(targets[(key.A_Const.ival.ival ?? 0) - 1]?.val);
    const fields = 'ColumnRef' in key ? key.ColumnRef.fields : undefined;
    const name = fields?.length === 1 && 'String' in fields[0] ? fields[0].String.sval : undefined;
    return name !== undefined && targets.some((t) => t.name === name && hasVolatile(t.val));
  });
}

// null = оператор трассируется полностью
export function unsupportedReason(stmt: ParsedStatement): string | null {
  if (stmt.kind !== 'select' || !('SelectStmt' in stmt.ast))
    return `Пока не анимируется: ${KIND_LABELS[stmt.kind]}`;
  const bad = [...selectFeatures(stmt.ast.SelectStmt)].filter((f) => !SUPPORTED.has(f));
  return bad.length ? `Пока не анимируется: ${bad.map((f) => FEATURE_LABELS[f]).join(', ')}` : null;
}

// Таблица из снапшота по имени из запроса: временные раньше public, как в search_path
export function findTable(
  schema: SchemaSnapshot,
  schemaName: string | undefined,
  name: string,
): TableInfo | null {
  const matches = schema.tables.filter(
    (t) =>
      t.name === name && (schemaName ? t.schema === schemaName : t.kind === 'temp' || t.schema === 'public'),
  );
  return matches.find((t) => t.kind === 'temp') ?? matches[0] ?? null;
}

// Что подсветить на доске: все упомянутые таблицы и колонки
export function touchedOf(ast: Node, schema: SchemaSnapshot): { tableIds: string[]; columns: string[] } {
  const tables = new Map<string, TableInfo>(); // алиас или имя → таблица
  const names: Array<{ qualifier: string | null; name: string }> = [];
  walk(ast, (key, value) => {
    if (key === 'RangeVar') {
      const rv = value as { schemaname?: string; relname?: string; alias?: { aliasname?: string } };
      const table = rv.relname ? findTable(schema, rv.schemaname, rv.relname) : null;
      if (table) tables.set(rv.alias?.aliasname ?? table.name, table);
    }
    if (key === 'ColumnRef') {
      const parts = ((value as { fields?: Node[] }).fields ?? []).flatMap((n) =>
        'String' in n ? [n.String.sval ?? ''] : [],
      );
      if (parts.length)
        names.push({
          qualifier: parts.length > 1 ? parts[parts.length - 2] : null,
          name: parts[parts.length - 1],
        });
    }
  });
  const columns = new Set<string>();
  for (const { qualifier, name } of names) {
    const candidates = qualifier
      ? [tables.get(qualifier)].filter((t) => t !== undefined)
      : [...tables.values()];
    for (const t of candidates) if (t.columns.some((c) => c.name === name)) columns.add(`${t.id}.${name}`);
  }
  return { tableIds: [...new Set([...tables.values()].map((t) => t.id))], columns: [...columns] };
}
