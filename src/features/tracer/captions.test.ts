import { describe, expect, it } from 'vitest';
import { captions, limitLabel, plural } from './captions';

describe('captions', () => {
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
  it('подписи стадий', () => {
    expect(captions.scan('book', 'b', 11)).toBe('FROM book AS b: 11 строк');
    expect(captions.filter(11, 7, 1)).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
    expect(captions.distinct(6, 4)).toBe('DISTINCT: 6 строк → 4 уникальные');
    expect(captions.limit(limitLabel(3, 2, false), 11, 3)).toBe('OFFSET 2, LIMIT 3: осталось 3 из 11 строк');
    expect(limitLabel(1, 0, true)).toBe('FETCH FIRST 1 WITH TIES');
    expect(limitLabel(null, 0, false)).toBe('LIMIT ALL');
    expect(limitLabel(null, 9, false)).toBe('OFFSET 9');
  });
});
