import type { FkInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { ident, type Prober, TraceFallback } from '../probe';
import type { Column, Relation, RowKey } from '../types';
import type { Target } from './shared';
import { snapshot } from './shared';

interface CascadeSnapshot {
  target: Target;
  before: Relation;
}

type Cascade = { tableId: string; deleted: RowKey[]; updated: RowKey[] };
type CascadeEvent = 'delete' | 'update';

const changesRows = (action: FkInfo['onDelete']) =>
  action === 'CASCADE' || action === 'SET NULL' || action === 'SET DEFAULT';

const setAction = (action: FkInfo['onDelete']) => action === 'SET NULL' || action === 'SET DEFAULT';
const actionFor = (fk: FkInfo, event: CascadeEvent) => (event === 'delete' ? fk.onDelete : fk.onUpdate);

// Зависимые таблицы обходятся от цели к потомкам, в порядке волны каскада.
export function cascadeTargets(
  tableId: string,
  schema: SchemaSnapshot,
  event: CascadeEvent = 'delete',
): FkInfo[] {
  const found: FkInfo[] = [];
  const seen = new Set([tableId]);
  const visit = (parentId: string) => {
    for (const fk of schema.fks.filter(
      (item) => item.to.tableId === parentId && changesRows(actionFor(item, event)),
    )) {
      if (seen.has(fk.from.tableId)) continue;
      seen.add(fk.from.tableId);
      found.push(fk);
      visit(fk.from.tableId);
    }
  };
  visit(tableId);
  return found;
}

function targetOf(table: TableInfo): Target {
  const alias = table.name;
  const columns: Column[] = table.columns.map((column) => ({
    name: column.name,
    type: column.type,
    source: { alias, column: column.name },
  }));
  return { table, alias, sql: `${ident(table.schema)}.${ident(table.name)}`, columns };
}

// Снимки до прогона: SET NULL/DEFAULT без PK нельзя честно сопоставить с новой версией строки.
export async function captureCascades(
  tableId: string,
  schema: SchemaSnapshot,
  prober: Prober,
  event: CascadeEvent,
): Promise<CascadeSnapshot[]> {
  const captured: CascadeSnapshot[] = [];
  for (const fk of cascadeTargets(tableId, schema, event)) {
    const table = schema.tables.find((item) => item.id === fk.from.tableId);
    if (!table) continue;
    if (
      (setAction(actionFor(fk, event)) || event === 'update') &&
      !table.columns.some((column) => column.isPk)
    )
      throw new TraceFallback(
        event === 'update'
          ? 'Пока не анимируется: каскад UPDATE без первичного ключа'
          : 'Пока не анимируется: каскад SET NULL/DEFAULT без первичного ключа',
      );
    const target = targetOf(table);
    captured.push({ target, before: await snapshot(prober, target) });
  }
  return captured;
}

const primaryKey = (values: unknown[], indexes: number[]) =>
  JSON.stringify(indexes.map((index) => values[index]));

// После каскада новый ctid с тем же PK означает UPDATE, отсутствие PK - DELETE.
export async function cascadeDiff(prober: Prober, captured: CascadeSnapshot[]): Promise<Cascade[]> {
  const cascades: Cascade[] = [];
  for (const { target, before } of captured) {
    const after = await snapshot(prober, target);
    const pk = target.table.columns.flatMap((column, index) => (column.isPk ? [index] : []));
    if (!pk.length) {
      const afterKeys = new Set(after.rows.map((item) => item.key));
      const deleted = before.rows.filter((item) => !afterKeys.has(item.key)).map((item) => item.key);
      if (deleted.length) cascades.push({ tableId: target.table.id, deleted, updated: [] });
      continue;
    }
    const afterByPk = new Map(after.rows.map((item) => [primaryKey(item.values, pk), item]));
    const deleted: RowKey[] = [];
    const updated: RowKey[] = [];
    for (const item of before.rows) {
      const current = afterByPk.get(primaryKey(item.values, pk));
      if (!current) deleted.push(item.key);
      else if (current.key !== item.key) updated.push(item.key);
    }
    if (deleted.length || updated.length) cascades.push({ tableId: target.table.id, deleted, updated });
  }
  return cascades;
}
