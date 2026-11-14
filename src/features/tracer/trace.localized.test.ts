import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { traceSql } from '../../../tests/helpers/trace';

function captionsOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(captionsOf);
  return Object.entries(value).flatMap(([key, item]) =>
    (key === 'caption' || key === 'fallbackReason') && typeof item === 'string' ? [item] : captionsOf(item),
  );
}

describe('язык трассы', () => {
  it.each([
    ['SELECT', 'select title from book where price > 500'],
    ['JOIN', 'select b.title, a.name from book b join author a on b.author_id = a.author_id'],
    ['CTE', 'with x as (select * from book where price > 500) select title from x'],
    ['DML', 'update book set price = 123 where book_id = 1'],
    ['WINDOW', 'select row_number() over (order by book_id), title from book'],
    ['final-only', 'select * from book for update'],
    ['ошибка', 'select bad_column from book'],
    ['ошибка DDL', 'create table author (id int)'],
    ['ошибка DML', 'insert into author (author_id, name) overriding system value values (999, null)'],
    ['функция в SELECT', 'select unnest(array[1,2])'],
    ['CTE без материализации', 'with x as not materialized (select * from book) select * from x'],
    ['транзакция', 'rollback'],
    ['множества', 'select author_id from book union select author_id from author'],
    [
      'рекурсия',
      'with recursive nums(n) as (select 1 union all select n + 1 from nums where n < 3) select n from nums',
    ],
    [
      'коррелированный подзапрос',
      'select title from book b where exists (select 1 from author a where a.author_id = b.author_id)',
    ],
  ])('%s: английские подписи сохраняют результат и структуру', (name, sql) =>
    withDataset('bookstore', async (db) => {
      const ru = await inPreview(db, () => traceSql(db, sql, { locale: 'ru' }));
      const en = await inPreview(db, () => traceSql(db, sql, { locale: 'en' }));
      expect(en.mode).toBe(ru.mode);
      if (
        [
          'SELECT',
          'JOIN',
          'CTE',
          'DML',
          'WINDOW',
          'множества',
          'рекурсия',
          'коррелированный подзапрос',
        ].includes(name)
      )
        expect(en.mode, en.fallbackReason).toBe('full');
      expect(en.stages.map((stage) => stage.kind)).toEqual(ru.stages.map((stage) => stage.kind));
      expect(en.result).toEqual(ru.result);
      expect(en.error).toEqual(ru.error);
      const captions = captionsOf(en);
      expect(captions.length).toBeGreaterThan(0);
      expect(captions.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    }),
  );

  it('сжатая трасса использует английские счётчики', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book where price > 500 order by title limit 2', {
          locale: 'en',
          maxRows: 5,
        });
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.stages.every((stage) => stage.compressed)).toBe(true);
        expect(captionsOf(trace).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
      }),
    ));
});
