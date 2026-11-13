import { describe, expect, it } from 'vitest';
import { plural, rowsWord } from '@/lib/plural';

describe('plural', () => {
  it('склонение по числу', () => {
    const w = (n: number) => plural(n, 'строка', 'строки', 'строк');
    expect([1, 2, 5, 11, 12, 21, 22, 111, 0].map(w)).toEqual([
      'строка',
      'строки',
      'строк',
      'строк',
      'строк',
      'строка',
      'строки',
      'строк',
      'строк',
    ]);
  });

  it('подписывает ноль, одну и несколько строк на английском', () => {
    expect([0, 1, 2].map((n) => rowsWord(n, 'en'))).toEqual(['0 rows', '1 row', '2 rows']);
  });
});
