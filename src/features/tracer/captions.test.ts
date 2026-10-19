import { describe, expect, it } from 'vitest';
import { captions, limitLabel } from './captions';

describe('captions', () => {
  it('подписи стадий', () => {
    expect(captions.scan('book', 'b', 11)).toBe('FROM book AS b: 11 строк');
    expect(captions.filter(11, 7, 1)).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
    expect(captions.distinct(6, 4)).toBe('DISTINCT: 6 строк → 4 уникальные');
    expect(captions.limit(limitLabel(3, 2, false), 11, 3)).toBe('OFFSET 2, LIMIT 3: осталось 3 из 11 строк');
    expect(limitLabel(1, 0, true)).toBe('FETCH FIRST 1 WITH TIES');
    expect(limitLabel(null, 0, false)).toBe('LIMIT ALL');
    expect(limitLabel(null, 9, false)).toBe('OFFSET 9');
  });

  it('после «из» число в родительном падеже', () => {
    expect(captions.limit('LIMIT 2', 3, 2)).toBe('LIMIT 2: осталось 2 из 3 строк');
    expect(captions.filter(21, 20, 0)).toBe('WHERE: осталось 20 из 21 строки');
    expect(captions.having(2, 1, 0)).toBe('HAVING: осталось 1 из 2 групп');
    expect(captions.having(1, 1, 0)).toBe('HAVING: осталось 1 из 1 группы');
    expect(captions.filter(11, 0, 0)).toBe('WHERE: осталось 0 из 11 строк');
    expect(captions.filter(101, 0, 0)).toBe('WHERE: осталось 0 из 101 строки');
    expect(captions.filter(111, 0, 0)).toBe('WHERE: осталось 0 из 111 строк');
  });
});
