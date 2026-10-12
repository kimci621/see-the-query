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
      }),
    ));
});
