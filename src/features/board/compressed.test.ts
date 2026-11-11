import { describe, expect, it } from 'vitest';
import { col, table } from './__fixtures__/schema';
import { hiddenRowsLabel, isCompressed } from './compressed';

const large = (count: number, rows = 5) =>
  table(
    'public.orders',
    [col('id', 'int')],
    Array.from({ length: rows }, (_, i) => [i]),
    count,
  );

describe('сжатый вид таблицы', () => {
  it('включается после 1000 строк', () => {
    expect(isCompressed(large(1000))).toBe(false);
    expect(isCompressed(large(1001))).toBe(true);
  });

  it('подпись учитывает доступные строки и склоняет их число', () => {
    expect(hiddenRowsLabel(large(100000))).toMatch(/^ещё 99\s995 строк$/);
    expect(hiddenRowsLabel(large(1006))).toMatch(/^ещё 1\s001 строка$/);
    expect(hiddenRowsLabel(large(1006, 2))).toMatch(/^ещё 1\s004 строки$/);
  });
});
