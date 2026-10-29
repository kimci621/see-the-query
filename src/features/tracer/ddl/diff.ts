import type { SchemaSnapshot } from '@/features/db/introspect';
import type { SchemaDiff } from '../types';

export interface Renames {
  columns: Array<{ tableId: string; from: string; to: string }>;
  tables: Array<{ from: string; to: string }>;
}

const constraints = (schema: SchemaSnapshot) =>
  schema.tables.flatMap((table) => [
    ...table.constraints.map((item) => ({ tableId: table.id, ...item })),
    ...table.columns
      .filter((column) => !column.nullable)
      .map((column) => ({
        tableId: table.id,
        name: `${column.name}_not_null`,
        kind: 'n' as const,
        columns: [column.name],
      })),
  ]);

export function diffSchemas(before: SchemaSnapshot, after: SchemaSnapshot, renames: Renames): SchemaDiff {
  const beforeTables = new Map(before.tables.map((table) => [table.id, table]));
  const afterTables = new Map(after.tables.map((table) => [table.id, table]));
  const renamedFrom = new Set(renames.tables.map((item) => item.from));
  const renamedTo = new Set(renames.tables.map((item) => item.to));
  const addedTables = after.tables
    .map((table) => table.id)
    .filter((id) => !beforeTables.has(id) && !renamedTo.has(id));
  const droppedTables = before.tables
    .map((table) => table.id)
    .filter((id) => !afterTables.has(id) && !renamedFrom.has(id));
  const addedColumns: SchemaDiff['addedColumns'] = [];
  const droppedColumns: SchemaDiff['droppedColumns'] = [];
  const alteredColumns: SchemaDiff['alteredColumns'] = [];
  for (const [id, oldTable] of beforeTables) {
    const newTable = afterTables.get(id);
    if (!newTable) continue;
    const renamed = renames.columns.filter((item) => item.tableId === id);
    const oldNames = new Set(oldTable.columns.map((column) => column.name));
    const newNames = new Set(newTable.columns.map((column) => column.name));
    for (const column of newTable.columns)
      if (!oldNames.has(column.name) && !renamed.some((item) => item.to === column.name))
        addedColumns.push({ tableId: id, column: column.name });
    for (const column of oldTable.columns)
      if (!newNames.has(column.name) && !renamed.some((item) => item.from === column.name))
        droppedColumns.push({ tableId: id, column: column.name });
    for (const column of oldTable.columns) {
      const next = newTable.columns.find((item) => item.name === column.name);
      if (next && next.type !== column.type)
        alteredColumns.push({ tableId: id, column: column.name, before: column.type, after: next.type });
    }
  }
  const beforeConstraints = constraints(before);
  const afterConstraints = constraints(after);
  const key = (item: { tableId: string; name: string }) => `${item.tableId}\u0003${item.name}`;
  const oldConstraints = new Set(beforeConstraints.map(key));
  const newConstraints = new Set(afterConstraints.map(key));
  const indexes = (schema: SchemaSnapshot) =>
    schema.tables.flatMap((table) => table.indexes.map((item) => ({ tableId: table.id, name: item.name })));
  const oldIndexes = new Set(indexes(before).map(key));
  const newIndexes = new Set(indexes(after).map(key));
  return {
    addedTables,
    droppedTables,
    addedColumns,
    droppedColumns,
    renamedColumns: renames.columns,
    alteredColumns,
    addedConstraints: afterConstraints.filter((item) => !oldConstraints.has(key(item))),
    droppedConstraints: beforeConstraints
      .filter((item) => !newConstraints.has(key(item)))
      .map(({ tableId, name }) => ({ tableId, name })),
    addedIndexes: indexes(after).filter((item) => !oldIndexes.has(key(item))),
    droppedIndexes: indexes(before).filter((item) => !newIndexes.has(key(item))),
    addedSchemas: after.schemas.filter((item) => !before.schemas.includes(item)),
    droppedSchemas: before.schemas.filter((item) => !after.schemas.includes(item)),
    renamedTables: renames.tables,
    before,
    after,
  };
}
