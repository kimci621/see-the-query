import { describe, expect, it } from 'vitest';
import { alignWindow } from './align';

// Ключ строки = 'имя', кортеж сортировки и значения заданы таблицами
const tuple: Record<string, string> = { a: '1', b: '2', c: '2', d: '2', e: '3' };
const tupleOf = (k: string) => tuple[k];
const canonOf = (k: string) => k;

describe('alignWindow', () => {
  it('серия на правой границе: внутрь окна попадает строка из эталона', () => {
    // окно [0, 2): a и одна из b/c/d; Postgres вернул d
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'd'], 0, 2)).toEqual([
      'a',
      'd',
      'b',
      'c',
      'e',
    ]);
  });
  it('серия на левой границе (OFFSET): строка из эталона встаёт в конец серии', () => {
    // окно [2, 5): две из b/c/d и e; Postgres вернул b, d, e
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['b', 'd', 'e'], 2, 5)).toEqual([
      'a',
      'c',
      'b',
      'd',
      'e',
    ]);
  });
  it('серия внутри окна и вне его не трогается', () => {
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'b', 'c', 'd'], 0, 4)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });
  it('без ORDER BY все строки в одной серии', () => {
    expect(alignWindow(['a', 'b', 'c'], () => '', canonOf, ['c'], 0, 1)).toEqual(['c', 'a', 'b']);
  });
  it('серия внутри окна идёт в порядке эталона', () => {
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'd', 'b', 'c', 'e'], 0, 5)).toEqual(
      ['a', 'd', 'b', 'c', 'e'],
    );
  });
  it('серия на границе окна: внутри окна тоже порядок эталона', () => {
    // окно [0, 3): a и две из b/c/d; Postgres вернул a, d, c
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'd', 'c'], 0, 3)).toEqual([
      'a',
      'd',
      'c',
      'b',
      'e',
    ]);
  });
});
