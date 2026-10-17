import { describe, expect, it } from 'vitest';
import { plural } from '@/lib/plural';

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
});
