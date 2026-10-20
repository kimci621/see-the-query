import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { relationsOf } from '@/features/sql/relations';
import type { ColumnRef, ParsedStatement, RangeRef } from '@/features/sql/types';

// Какие таблицы и колонки оператора существуют в текущей схеме (для фокуса доски).
// expanded: таблицы под звёздочкой (`*` - все таблицы оператора, `t.*` - одна), доска их разворачивает.
// Неизвестные таблицы (CTE, TEMP до Ф10, функции) пропускаем молча.
export function touchedOf(
  stmt: ParsedStatement,
  schema: SchemaSnapshot | null,
): { tableIds: string[]; columns: string[]; expanded: string[] } {
  if (!schema) return { tableIds: [], columns: [], expanded: [] };
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
  const expanded = new Set<string>();
  for (const c of rel.columns) {
    if (c.name === '*') {
      // по имени квалифицирует только таблица без алиаса: `select book.* from book b` - ошибка Postgres
      const own = tables.filter((t) => c.qualifier === null || (t.alias ?? t.name) === c.qualifier);
      // звёздочка задействует все поля таблицы: подсвечиваем их все (спека 1)
      for (const t of own) {
        const info = resolveTable(t, schema);
        if (!info) continue;
        expanded.add(info.id);
        for (const col of info.columns) {
          const id = `${info.id}.${col.name}`;
          if (!columns.includes(id)) columns.push(id);
        }
      }
      continue;
    }
    const resolved = resolveColumn(c, tables, schema);
    if (resolved && !columns.includes(resolved.id)) columns.push(resolved.id);
  }
  return { tableIds, columns, expanded: tableIds.filter((id) => expanded.has(id)) };
}

// Целевая таблица INSERT/UPDATE/DELETE (relation оператора, не USING/FROM/подзапросы) в текущей схеме.
// Для остальных операторов и неизвестной таблицы null
export function dmlTargetOf(stmt: ParsedStatement, schema: SchemaSnapshot | null): string | null {
  return relationOf(stmt, schema, ['InsertStmt', 'UpdateStmt', 'DeleteStmt']);
}

// Таблица ALTER TABLE (и ALTER TABLE ... RENAME COLUMN) в текущей схеме, иначе null
export function alteredTableOf(stmt: ParsedStatement, schema: SchemaSnapshot | null): string | null {
  return relationOf(stmt, schema, ['AlterTableStmt', 'RenameStmt']);
}

function relationOf(stmt: ParsedStatement, schema: SchemaSnapshot | null, nodes: string[]): string | null {
  if (!schema) return null;
  const body = stmt.ast as unknown as Record<
    string,
    { relation?: { relname?: string; schemaname?: string } } | undefined
  >;
  const key = nodes.find((n) => n in body);
  const rel = key ? body[key]?.relation : undefined;
  if (typeof rel?.relname !== 'string') return null;
  const ref = { schema: rel.schemaname ?? null, name: rel.relname, alias: null, from: 0, to: 0 };
  return resolveTable(ref, schema)?.id ?? null;
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
