import type { SchemaSnapshot } from '@/features/db/introspect';

// Спецификация для встроенного автодополнения @codemirror/lang-sql:
// { 'public.book': ['book_id', ...], book: ['book_id', ...] }.
// Короткое имя не добавляем, если таблица с таким именем есть в нескольких схемах.
export function buildSchemaSpec(schema: SchemaSnapshot): Record<string, readonly string[]> {
  const spec: Record<string, readonly string[]> = {};
  const byName = new Map<string, number>();
  for (const t of schema.tables) byName.set(t.name, (byName.get(t.name) ?? 0) + 1);
  for (const t of schema.tables) {
    spec[t.id] = t.columns.map((c) => c.name);
    if ((byName.get(t.name) ?? 0) === 1) spec[t.name] = t.columns.map((c) => c.name);
  }
  return spec;
}
