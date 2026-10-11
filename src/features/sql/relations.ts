import { byteToChar } from './offsets';
import type { ColumnRef, ParsedStatement, RangeRef, Relations } from './types';

// Таблицы и колонки оператора: рекурсивный обход AST, узлы RangeVar и ColumnRef.
// Рекурсивный обход устойчив к разным видам операторов (select/insert/update/delete),
// колонки подзапросов собираются тоже - это упоминаемые объекты.
export function relationsOf(stmt: ParsedStatement): Relations {
  const tables: RangeRef[] = [];
  const columns: ColumnRef[] = [];
  const seen = new Set<string>();

  walk(stmt.ast, (key, value) => {
    if (key === 'RangeVar') {
      const name = value.relname;
      if (typeof name !== 'string' || seen.has(`t:${name}`)) return;
      seen.add(`t:${name}`);
      const schema = typeof value.schemaname === 'string' ? value.schemaname : null;
      const aliasObj = value.alias as { aliasname?: unknown } | undefined;
      const alias = typeof aliasObj?.aliasname === 'string' ? aliasObj.aliasname : null;
      // location узлов абсолютны (байты полного текста): переводим в относительные оператора
      const from =
        typeof value.location === 'number' ? byteToChar(stmt.text, value.location - stmt.byteFrom) : 0;
      const length = (schema != null ? `${schema}.${name}` : name).length;
      tables.push({ schema, name, alias, from: stmt.from + from, to: stmt.from + from + length });
    } else {
      const fields = Array.isArray(value.fields) ? value.fields : [];
      const names = fields.map((f) => {
        const field = f as Record<string, { sval?: string }>;
        if ('String' in field) return field.String?.sval ?? '';
        if ('A_Star' in field) return '*';
        return '';
      });
      if (names.length === 0 || names.some((n) => n === '')) return;
      if (typeof value.location !== 'number') return;
      const name = names[names.length - 1] ?? '';
      const qualifier = names.length >= 2 ? names[0] : null;
      const from = stmt.from + byteToChar(stmt.text, value.location - stmt.byteFrom);
      const to = from + refLength(stmt.text, value.location - stmt.byteFrom, name);
      const id = `c:${from}:${name}`;
      if (seen.has(id)) return;
      seen.add(id);
      columns.push({ qualifier, name, from, to });
    }
  });

  return { tables, columns };
}

// Длина текста ссылки колонки: квалификатор, точки и имя (звёздочка тоже).
// Пробелы вокруг '.' в SQL допустимы, поэтому меряем по тексту, а не по числу полей.
function refLength(text: string, byteOffset: number, name: string): number {
  const from = byteToChar(text, byteOffset);
  const m = /^(?:[A-Za-z_$][\w$]*\s*\.\s*)*(?:[A-Za-z_$][\w$]*|\*)/.exec(text.slice(from));
  return m ? m[0].length : name.length;
}

function walk(node: unknown, visit: (key: string, value: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (value === null || typeof value !== 'object') continue;
    if (key === 'RangeVar') visit(key, value as Record<string, unknown>);
    else if (key === 'relation' && 'relname' in value) visit('RangeVar', value as Record<string, unknown>);
    else if (key === 'ColumnRef') visit(key, value as Record<string, unknown>);
    walk(value, visit);
  }
}
