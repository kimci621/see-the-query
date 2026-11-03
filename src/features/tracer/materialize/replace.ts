// Обход AST: RangeVar с именем CTE заменяем на временную таблицу, сохраняя алиас
export function replaceRangeVars(node: unknown, names: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => replaceRangeVars(item, names));
  if (!node || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };
  if (typeof copy.relname === 'string' && names.has(copy.relname)) {
    const alias = copy.alias as { aliasname?: string } | undefined;
    const original = copy.relname;
    copy.schemaname = 'pg_temp';
    copy.relname = names.get(original) ?? original;
    if (!alias) copy.alias = { aliasname: original };
  }
  for (const [key, value] of Object.entries(copy)) copy[key] = replaceRangeVars(value, names);
  return copy;
}
