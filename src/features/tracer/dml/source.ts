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

// Колонки уникальных ключей, по которым ON CONFLICT ищет столкновение.
export function conflictColumnSets(body: DmlNode, target: Target): string[][] {
  const infer = body.onConflictClause?.infer;
  const inferred = (infer?.indexElems ?? []).flatMap((item) =>
    item.IndexElem.name ? [item.IndexElem.name] : [],
  );
  if (inferred.length) return [inferred];
  const named = infer?.conname;
  const constraint = named
    ? target.table.constraints.find((item) => item.name === named && (item.kind === 'p' || item.kind === 'u'))
    : null;
  if (constraint) return [constraint.columns];
  const indexes = target.table.indexes
    .filter((item) => item.unique)
    .map((item) => indexColumns(item.definition, target));
  const all = [
    ...target.table.constraints
      .filter((item) => item.kind === 'p' || item.kind === 'u')
      .map((item) => item.columns),
    ...indexes,
  ].filter((columns) => columns.length);
  return [...new Map(all.map((columns) => [columns.join('\u0003'), columns])).values()];
}

function indexColumns(definition: string, target: Target): string[] {
  const list = definition.match(/\bUSING\s+\w+\s+\(([^()]*)\)/i)?.[1];
  if (!list) return [];
  const known = new Set(target.columns.map((column) => column.name));
  return list
    .split(',')
    .map((part) => part.trim().replace(/^"|"$/g, '').split(/\s+/)[0])
    .filter((column) => known.has(column));
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
