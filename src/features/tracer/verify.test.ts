import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@/features/db/types';
import type { Relation } from './types';
import { canon, sameResult } from './verify';

const rel = (rows: unknown[][]): Relation => ({
  columns: [],
  rows: rows.map((values, i) => ({ key: `r:${i}`, lineage: {}, values })),
});
const ref = (rows: unknown[][]): QueryResult => ({ fields: [], rows });

describe('verify', () => {
  it('канон различает типы и раскрывает объекты', () => {
    expect(canon(null)).toBe('null');
    expect(canon('1')).not.toBe(canon(1));
    expect(canon(new Date('2024-01-01T00:00:00Z'))).toBe('d:2024-01-01T00:00:00.000Z');
    expect(canon({ a: 1 })).toBe('j:{"a":1}');
  });
  it('мультимножество без ORDER BY: порядок не важен, дубли важны', () => {
    expect(sameResult(rel([['a'], ['b']]), ref([['b'], ['a']]), null)).toBe(true);
    expect(sameResult(rel([['a'], ['a']]), ref([['a'], ['b']]), null)).toBe(false);
    expect(sameResult(rel([['a']]), ref([['a'], ['a']]), null)).toBe(false);
  });
  it('с ORDER BY сравнивается порядок ключей, внутри равных ключей порядок свободен', () => {
    expect(
      sameResult(
        rel([
          ['x', 1],
          ['y', 1],
          ['z', 2],
        ]),
        ref([
          ['y', 1],
          ['x', 1],
          ['z', 2],
        ]),
        [1],
      ),
    ).toBe(true);
    expect(
      sameResult(
        rel([
          ['z', 2],
          ['x', 1],
          ['y', 1],
        ]),
        ref([
          ['x', 1],
          ['y', 1],
          ['z', 2],
        ]),
        [1],
      ),
    ).toBe(false);
  });
});
