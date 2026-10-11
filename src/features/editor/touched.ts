import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { relationsOf } from '@/features/sql/relations';
import type { ColumnRef, ParsedStatement, RangeRef } from '@/features/sql/types';

// Какие таблицы и колонки оператора существуют в текущей схеме (для фокуса доски).
// Неизвестные таблицы (CTE, TEMP до Ф10, функции) пропускаем молча.
export function touchedOf(
  stmt: ParsedStatement,
  schema: SchemaSnapshot | null,
): { tableIds: string[]; columns: string[] } {
  if (!schema) return { tableIds: [], columns: [] };
  const rel = relationsOf(stmt);
  const tableIds: string[] = [];
  const tables: RangeRef[] = [];
  for (const t of rel.tables) {
    const info = resolveTable(t, schema);
    if (!info) continue;
    if (!tableIds.includes(info.id)) tableIds.push(info.id);
    tables.push(t);
  }
  const columns: string[] = [];
  for (const c of rel.columns) {
    const resolved = resolveColumn(c, tables, schema);
    if (resolved && !columns.includes(resolved.id)) columns.push(resolved.id);
  }
  return { tableIds, columns };
}

export function resolveColumn(
  column: ColumnRef,
  tables: RangeRef[],
  schema: SchemaSnapshot | null,
): { id: string; type: string } | null {
  if (!schema) return null;
  let target: TableInfo | null = null;
  if (column.qualifier) {
    for (const t of tables) {
      if (t.alias === column.qualifier || t.name === column.qualifier) {
        target = resolveTable(t, schema);
        break;
      }
    }
  } else {
    // без квалификатора: колонка должна быть ровно в одной таблице запроса
    const found: TableInfo[] = [];
    for (const t of tables) {
      const info = resolveTable(t, schema);
      if (info?.columns.some((c) => c.name === column.name)) found.push(info);
    }
    target = found.length === 1 ? found[0] : null;
  }
  const col = target?.columns.find((c) => c.name === column.name);
  return target && col ? { id: `${target.id}.${col.name}`, type: col.type } : null;
}

// Резолв ссылки таблицы: схема-имя, иначе имя без схемы (public имеет приоритет, иначе единственная)
function resolveTable(ref: RangeRef, schema: SchemaSnapshot): TableInfo | null {
  const candidates = schema.tables.filter(
    (t) => t.name === ref.name && (ref.schema == null || t.schema === ref.schema),
  );
  if (ref.schema != null) return candidates[0] ?? null;
  return candidates.find((t) => t.schema === 'public') ?? (candidates.length === 1 ? candidates[0] : null);
}
