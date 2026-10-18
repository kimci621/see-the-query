import type { QueryResult } from '@/features/db/types';
import type { Relation } from './types';

// Каноническая строка значения: одинаковые значения дают одинаковую строку при любом пути получения
export function canon(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  // ponytail: infinity и даты до н. э. PGlite отдаёт как Invalid Date, различить их по значению нельзя
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'd:invalid' : `d:${value.toISOString()}`;
  if (typeof value === 'object') return `j:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}

export function rowCanon(values: unknown[]): string {
  return values.map(canon).join('\u0001');
}

// Финальная стадия против прямого выполнения: мультимножество строк, при ORDER BY ещё порядок ключей
export function sameResult(
  stageOutput: Relation,
  reference: QueryResult,
  orderKeys: number[] | null,
  canonOf: (values: unknown[]) => string = rowCanon,
): boolean {
  const ours = stageOutput.rows.map((r) => canonOf(r.values));
  const theirs = reference.rows.map(canonOf);
  if (ours.length !== theirs.length) return false;
  const a = [...ours].sort();
  const b = [...theirs].sort();
  if (a.some((x, i) => x !== b[i])) return false;
  if (!orderKeys?.length) return true;
  const keyOf = (values: unknown[]) => orderKeys.map((i) => canon(values[i])).join('\u0002');
  return stageOutput.rows.every((r, i) => keyOf(r.values) === keyOf(reference.rows[i]));
}
