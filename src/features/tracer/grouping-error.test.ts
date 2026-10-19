import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../tests/helpers/trace';

describe('42803 grouping_error', () => {
  it('фокус: конкретная колонка не из GROUP BY, а не всё, что упомянуто', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, count(*) from book group by author_id');
        expect(trace).toMatchObject({ mode: 'final-only', error: { code: '42803' }, result: null });
        expect(stageOf(trace, 'error').focus).toEqual({
          tableIds: ['public.book'],
          columns: ['public.book.title'],
        });
      }),
    ));
  it('колонка через алиас находит свою таблицу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select a.name, count(*) from book b join author a on a.author_id = b.author_id group by b.author_id',
        );
        expect(stageOf(trace, 'error').focus).toEqual({
          tableIds: ['public.author'],
          columns: ['public.author.name'],
        });
        expect(trace.stages.map((s) => s.kind)).toEqual(['scan', 'scan', 'join', 'error']);
      }),
    ));
  it('перед ошибкой настоящие стадии до GROUP BY, в стадии ошибки состав групп', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book where price > 500 group by author_id');
        expect(trace.stages.map((s) => s.kind)).toEqual(['scan', 'filter', 'error']);
        const kept = Object.values(stageOf(trace, 'filter').verdicts).filter((v) => v === true).length;
        const { group } = stageOf(trace, 'error');
        expect(group?.keys).toEqual(['author_id']);
        expect(group?.keyColumns).toEqual([2]); // book_id, title, author_id
        expect(group?.groups.flatMap((g) => g.members)).toHaveLength(kept);
      }),
    ));
  it('другие 42803 без стадий до ошибки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book where count(price) > 1');
        expect(trace.stages.map((s) => s.kind)).toEqual(['error']);
      }),
    ));
});
