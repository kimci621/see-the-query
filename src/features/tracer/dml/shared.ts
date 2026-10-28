import type { Node } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { type DbError, DbException, type QueryResult } from '@/features/db/types';
import { ident, type Prober, sqlOf } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Column, Relation, Row, RowKey } from '../types';
import { findTable } from '../whitelist';

// Узлы AST libpg-query 18, с которыми работает Ф9
export interface RangeVarNode {
  schemaname?: string;
  relname: string;
  alias?: { aliasname: string };
}

export interface DmlNode {
  relation: RangeVarNode;
  cols?: Array<{ ResTarget: { name: string } }>;
  selectStmt?: Node;
  onConflictClause?: {
    action: string;
    infer?: { indexElems?: Array<{ IndexElem: { name?: string } }>; conname?: string };
  };
  whereClause?: Node;
  fromClause?: Node[];
  usingClause?: Node[];
  withClause?: unknown;
  returningClause?: { options?: unknown[]; exprs?: unknown[] };
}

export interface Target {
  table: TableInfo;
  alias: string;
  sql: string;
  columns: Column[];
}

export const keyOf = (alias: string, ctid: string): RowKey => rowKeyOf({ [alias]: ctid }, [alias]);

export const row = (alias: string, ctid: string, values: unknown[]): Row => ({
  key: keyOf(alias, ctid),
  lineage: { [alias]: ctid },
  values,
});

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Проба, ошибка которой часть трассы: DbException превращается в результат.
export async function tryRun(
  prober: Prober,
  sql: string,
): Promise<{ ok: true; value: QueryResult } | { ok: false; error: DbError }> {
  try {
    return { ok: true, value: await prober.run(sql) };
  } catch (error) {
    if (!(error instanceof DbException) || error.db.code.startsWith('VS')) throw error;
    return { ok: false, error: error.db };
  }
}

// Целевая таблица из снимка доски: представления не трассируем.
export function resolveTarget(schema: SchemaSnapshot, rv: RangeVarNode): Target | null {
  const table = findTable(schema, rv.schemaname, rv.relname);
  if (!table || (table.kind !== 'table' && table.kind !== 'temp')) return null;
  const alias = rv.alias?.aliasname ?? table.name;
  return {
    table,
    alias,
    sql: `${ident(table.schema)}.${ident(table.name)}`,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      source: { alias, column: column.name },
    })),
  };
}

// Все строки цели по ctid. Превышение maxRows передаётся в маршрут как ProbeOverflow.
export async function snapshot(prober: Prober, target: Target): Promise<Relation> {
  const alias = ident(target.alias);
  const result = await prober.rows(
    `SELECT ${alias}.ctid::text, ${alias}.* FROM ${target.sql} AS ${alias} ORDER BY ${alias}.ctid`,
  );
  return {
    columns: target.columns,
    rows: result.rows.map(([ctid, ...values]) => row(target.alias, ctid as string, values)),
  };
}

const columnRef = (...fields: string[]) => ({
  ColumnRef: {
    fields: fields.map((field) => (field === '*' ? { A_Star: {} } : { String: { sval: field } })),
  },
});

const resultTarget = (value: unknown, name?: string) => ({
  ResTarget: name ? { name, val: value } : { val: value },
});

// Один настоящий прогон: служебный RETURNING идёт перед исходным RETURNING пользователя.
// ponytail: RETURNING WITH (OLD AS o) у пользователя несовместим с old.*; редкий случай останется ошибкой Postgres.
export function instrument(ast: Node, nodeName: string): string {
  const copy = structuredClone(ast) as unknown as Record<string, DmlNode>;
  const body = copy[nodeName];
  const extra: unknown[] = [
    resultTarget(columnRef('old', 'ctid'), '__vs_old_ctid'),
    resultTarget(columnRef('new', 'ctid'), '__vs_new_ctid'),
    resultTarget(columnRef('old', '*')),
    resultTarget(columnRef('new', '*')),
  ];
  body.returningClause = {
    ...body.returningClause,
    exprs: [...extra, ...(body.returningClause?.exprs ?? [])],
  };
  return sqlOf(copy as unknown as Node);
}

// В панели результата остаётся только RETURNING пользователя.
export function userResult(result: QueryResult, prefix: number): QueryResult {
  const fields = result.fields.slice(prefix);
  return {
    fields,
    rows: fields.length ? result.rows.map((values) => values.slice(prefix)) : [],
    command: result.command,
    rowCount: result.rows.length,
  };
}

// Цель, таблица ошибки, колонки ограничения и другая сторона FK.
export function errorFocus(
  error: DbError,
  target: Target,
  schema: SchemaSnapshot,
): { tableIds: string[]; columns: string[] } {
  const tableIds = new Set([target.table.id]);
  const columns = new Set<string>();
  const errorSchema = error.schema?.startsWith('pg_temp_') ? 'pg_temp' : error.schema;
  const table = error.table ? findTable(schema, errorSchema, error.table) : null;
  if (table) {
    tableIds.add(table.id);
    if (error.column) columns.add(`${table.id}.${error.column}`);
    const constraint = table.constraints.find((item) => item.name === error.constraint);
    for (const column of constraint?.columns ?? []) columns.add(`${table.id}.${column}`);
    const fk = schema.fks.find((item) => item.name === error.constraint && item.from.tableId === table.id);
    if (fk) tableIds.add(fk.to.tableId);
  }
  return { tableIds: [...tableIds], columns: [...columns] };
}
