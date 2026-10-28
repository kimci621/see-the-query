import { describe, expect, it } from 'vitest';
import { captions, keyList, limitLabel } from './captions';

describe('captions', () => {
  it('подписи стадий', () => {
    expect(captions.scan('book', 'b', 11)).toBe('FROM book AS b: 11 строк');
    expect(captions.filter(11, 7, 1)).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
    expect(captions.dmlInsert(1, 6)).toBe('INSERT: +1 строка, 6 → 7');
    expect(captions.distinct(6, 4)).toBe('DISTINCT: 6 строк → 4 уникальные');
    expect(captions.limit(limitLabel(3, 2, false), 11, 3)).toBe('OFFSET 2, LIMIT 3: осталось 3 из 11 строк');
    expect(limitLabel(1, 0, true)).toBe('FETCH FIRST 1 WITH TIES');
    expect(limitLabel(null, 0, false)).toBe('LIMIT ALL');
    expect(limitLabel(null, 9, false)).toBe('OFFSET 9');
  });

  it('ключи без кавычек у простых имён, литералы и сложные имена как есть', () => {
    expect(keyList(['"position"', 'b."select" DESC'])).toBe('position, b.select DESC');
    expect(keyList([`COALESCE(x, '"y"')`, `'it''s "q"'`])).toBe(`COALESCE(x, '"y"'), 'it''s "q"'`);
    expect(keyList([`E'a\\b''c'`, 'lower("order")'])).toBe(`E'a\\b''c', lower(order)`);
    expect(keyList(['"Big Name"', '"a""b"'])).toBe('"Big Name", "a""b"');
    expect(captions.distinctOn(['"position"'], 8, 6)).toBe(
      'DISTINCT ON (position): 8 строк → 6, по одной на группу',
    );
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
