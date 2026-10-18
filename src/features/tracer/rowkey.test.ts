import { describe, expect, it } from 'vitest';
import { groupKey, resultKey, rowKeyOf } from './rowkey';

describe('rowkey', () => {
  it('склеивает lineage в порядке алиасов, null → ∅', () => {
    expect(rowKeyOf({ a: '(0,1)', b: '(0,3)' }, ['b', 'a'])).toBe('b=(0,3)|a=(0,1)');
    expect(rowKeyOf({ b: '(0,3)', a: null }, ['b', 'a'])).toBe('b=(0,3)|a=∅');
  });
  it('ключи групп и строк результата', () => {
    expect(groupKey(0)).toBe('g:0');
    expect(resultKey(2)).toBe('r:2');
  });
});
