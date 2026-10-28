import type { Node } from '@pgsql/types';
import type { DbError } from '@/features/db/types';
import { ident, type Prober, sqlOf } from '../probe';
import type { Relation, RowKey } from '../types';
import { type DmlNode, keyOf, type Target, tryRun } from './shared';

export function insertColumns(body: DmlNode, target: Target): string[] {
  return body.cols?.length
    ? body.cols.map((column) => column.ResTarget.name)
    : target.columns.map((column) => column.name);
}

// Исходные строки INSERT вычисляются до записи.
export async function sourceRelation(
  prober: Prober,
  body: DmlNode,
  target: Target,
): Promise<Relation | undefined> {
  if (!body.selectStmt) return undefined;
  const run = await tryRun(prober, `SELECT * FROM (${sqlOf(body.selectStmt)}) AS __vs_src`);
  if (!run.ok) return undefined;
  const names = insertColumns(body, target).slice(0, run.value.fields.length);
  return {
    columns: names.map((name) => ({
      name,
      type: target.columns.find((column) => column.name === name)?.type ?? 'unknown',
    })),
    rows: run.value.rows.map((values, index) => ({ key: `src:${index}`, lineage: {}, values })),
  };
}

// Существующие строки, совпавшие с исходными по колонкам UNIQUE или PK.
export async function collidingKeys(
  prober: Prober,
  body: DmlNode,
  target: Target,
  keyColumns: string[],
): Promise<RowKey[]> {
  const columns = insertColumns(body, target);
  if (!body.selectStmt || keyColumns.length === 0 || !keyColumns.every((column) => columns.includes(column)))
    return [];
  const alias = ident(target.alias);
  const sql = `SELECT ${alias}.ctid::text FROM ${target.sql} AS ${alias}
    WHERE (${keyColumns.map((column) => `${alias}.${ident(column)}`).join(', ')}) IN
      (SELECT ${keyColumns.map(ident).join(', ')} FROM (${sqlOf(body.selectStmt as Node)}) AS __vs_src(${columns.map(ident).join(', ')}))`;
  const run = await tryRun(prober, sql);
  return run.ok ? run.value.rows.map(([ctid]) => keyOf(target.alias, ctid as string)) : [];
}

// Для ошибки INSERT сохраняем попытку и строку, с которой произошёл конфликт.
export async function insertErrorExtras(
  prober: Prober,
  body: DmlNode,
  target: Target,
  error: DbError,
): Promise<{ attempted?: Relation; conflictKeys?: RowKey[] }> {
  const attempted = await sourceRelation(prober, body, target);
  const result = attempted ? { attempted } : {};
  if (error.code !== '23505' || !error.constraint) return result;
  const constraint = target.table.constraints.find((item) => item.name === error.constraint);
  const conflictKeys = constraint ? await collidingKeys(prober, body, target, constraint.columns) : [];
  return conflictKeys.length ? { ...result, conflictKeys } : result;
}
