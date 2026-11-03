import type { A_Const, SelectStmt } from '@pgsql/types';
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Column } from '../types';
import { findTable, walk } from '../whitelist';

// Литерал из значения внешней строки для подстановки в подзапрос
export function literal(value: unknown): A_Const {
  if (value === null || value === undefined) return { isnull: true };
  if (typeof value === 'boolean') return { boolval: { boolval: value } };
  if (typeof value === 'number')
    return Number.isSafeInteger(value) ? { ival: { ival: value } } : { fval: { fval: String(value) } };
  if (value instanceof Date) return { sval: { sval: value.toISOString() } };
  if (typeof value === 'object') return { sval: { sval: JSON.stringify(value) } };
  return { sval: { sval: String(value) } };
}

export interface InnerNames {
  aliases: Set<string>;
  columns: Set<string>;
}

// Алиасы и колонки, которые подзапрос видит сам: всё остальное в ColumnRef пришло снаружи
export function innerNames(schema: SchemaSnapshot, sel: SelectStmt): InnerNames {
  const aliases = new Set<string>();
  const columns = new Set<string>();
  walk(sel, (key, value) => {
    if (key !== 'RangeVar') return;
    const rv = value as { schemaname?: string; relname?: string; alias?: { aliasname?: string } };
    const table = rv.relname ? findTable(schema, rv.schemaname, rv.relname) : null;
    if (!table) return;
    aliases.add(rv.alias?.aliasname ?? table.name);
    for (const column of table.columns) columns.add(column.name);
  });
  return { aliases, columns };
}

// Значения внешней строки по квалифицированным и однозначным именам колонок
export function outerValues(columns: Column[], values: unknown[]): Map<string, unknown> {
  const qualified = new Map<string, unknown>();
  const bare = new Map<string, { value: unknown; count: number }>();
  columns.forEach((column, i) => {
    if (!column.source) return;
    const value = values[i];
    qualified.set(`${column.source.alias}.${column.source.column}`, value);
    const found = bare.get(column.source.column);
    if (found) found.count++;
    else bare.set(column.source.column, { value, count: 1 });
  });
  for (const [name, item] of bare) if (item.count === 1) qualified.set(name, item.value);
  return qualified;
}

// Подстановка значений внешней строки: ColumnRef на внешний алиас заменяется литералом
export function substituteOuter(
  node: unknown,
  outer: Map<string, unknown>,
  inner: InnerNames,
): { ast: unknown; count: number } {
  let count = 0;
  const walkNode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walkNode);
    if (!value || typeof value !== 'object') return value;
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if ('ColumnRef' in copy) {
      const fields = (copy.ColumnRef as { fields?: Array<{ String?: { sval?: string } }> }).fields ?? [];
      const names = fields.flatMap((field) => (field.String?.sval ? [field.String.sval] : []));
      const column = names.at(-1);
      const qualifier = names.length > 1 ? names.at(-2) : undefined;
      const key = qualifier
        ? inner.aliases.has(qualifier)
          ? undefined
          : `${qualifier}.${column}`
        : column && !inner.columns.has(column)
          ? column
          : undefined;
      if (key && outer.has(key)) {
        count++;
        return { A_Const: literal(outer.get(key)) };
      }
    }
    for (const [key, item] of Object.entries(copy)) copy[key] = walkNode(item);
    return copy;
  };
  return { ast: walkNode(node), count };
}
