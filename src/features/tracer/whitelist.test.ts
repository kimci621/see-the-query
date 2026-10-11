import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { initParser, parseSql } from '@/features/sql/parser';
import type { ParsedStatement } from '@/features/sql/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { selectFeatures, touchedOf, unsupportedReason } from './whitelist';

async function stmt(sql: string): Promise<ParsedStatement> {
  await initParser();
  const parsed = parseSql(sql);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements[0];
}
async function features(sql: string): Promise<string[]> {
  const s = await stmt(sql);
  if (!('SelectStmt' in s.ast)) throw new Error('не SELECT');
  return [...selectFeatures(s.ast.SelectStmt)].sort();
}

describe('whitelist', () => {
  it('распознаёт клаузы одной таблицы', async () => {
    expect(await features('select distinct on (a) a from t where b > 1 order by a limit 3')).toEqual([
      'distinct-on',
      'limit',
      'order',
      'select',
      'where',
    ]);
    expect(await features('select distinct a from t offset 2')).toEqual(['distinct', 'limit', 'select']);
    expect(await features('select 2 + 2')).toEqual(['no-from', 'select']);
  });
  it('volatile в SELECT и ORDER BY допустим, в WHERE и с DISTINCT нет', async () => {
    expect(unsupportedReason(await stmt('select random() from t order by random()'))).toBeNull();
    expect(unsupportedReason(await stmt('select a from t where random() < 0.5'))).toBe(
      'Пока не анимируется: volatile-функция в WHERE, DISTINCT или LIMIT',
    );
    expect(await features('select distinct random() from t')).toContain('volatile-other');
  });
  it('неподдерживаемое → причина на русском', async () => {
    expect(unsupportedReason(await stmt('select count(*) from book'))).toBe(
      'Пока не анимируется: агрегатные функции',
    );
    expect(unsupportedReason(await stmt('select b.title from book b join author a using (author_id)'))).toBe(
      'Пока не анимируется: JOIN',
    );
    expect(
      unsupportedReason(await stmt('select * from book where price > (select avg(price) from book)')),
    ).toBe('Пока не анимируется: подзапрос, агрегатные функции');
    expect(unsupportedReason(await stmt('select 1 where false'))).toBe(
      'Пока не анимируется: WHERE, ORDER BY или LIMIT без FROM',
    );
    expect(unsupportedReason(await stmt('update book set price = 1'))).toBe('Пока не анимируется: UPDATE');
  });
  it('touched: таблицы и колонки с учётом алиасов', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const schema = await introspect(db);
        const s = await stmt(
          'select b.title, name from book b join author a using (author_id) where price > 1',
        );
        expect(touchedOf(s.ast, schema)).toEqual({
          tableIds: ['public.book', 'public.author'],
          columns: ['public.book.title', 'public.author.name', 'public.book.price'],
        });
      }),
    ));
});
