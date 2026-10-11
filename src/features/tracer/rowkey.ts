import type { Lineage, RowKey } from './types';

// Ключ строки из lineage: 'b=(0,3)|a=(0,1)', нет пары → '∅'
export function rowKeyOf(lineage: Lineage, aliasOrder: string[]): RowKey {
  return aliasOrder.map((alias) => `${alias}=${lineage[alias] ?? '∅'}`).join('|');
}

// Ключ группы GROUP BY
export function groupKey(index: number): RowKey {
  return `g:${index}`;
}

// Ключ строки результата без исходной таблицы (SELECT без FROM)
export function resultKey(index: number): RowKey {
  return `r:${index}`;
}
