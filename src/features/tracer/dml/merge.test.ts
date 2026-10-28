import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

const MERGE = `merge into book b using (values (1, 700.00), (12, 100.00)) as s(id, price)
  on b.book_id = s.id
  when matched then update set price = s.price
  when not matched then insert (title, price) values ('Новая книга', s.price)`;

describe('MERGE', () => {
  it('ветки по строкам целевой таблицы', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, MERGE);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const dml = stageOf(trace, 'dml');
        expect(dml.mergeBranches['b=(0,1)']).toBe('matched_update');
        expect(Object.values(dml.mergeBranches).sort()).toEqual(['matched_update', 'not_matched_insert']);
        expect(dml.inserted).toHaveLength(1);
        expect(dml.updated).toHaveLength(1);
      }),
    ));

  it('WHEN NOT MATCHED BY SOURCE: final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'merge into review r using book b on r.book_id = b.book_id when not matched by source then delete',
        );
        expect(trace.mode).toBe('final-only');
      }),
    ));

  it('ветка DELETE помечает старый ключ', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'merge into review r using book b on r.book_id = b.book_id when matched then delete',
        );
        const dml = stageOf(trace, 'dml');
        expect(dml.mergeBranches['r=(0,1)']).toBe('matched_delete');
        expect(dml.deleted).toHaveLength(10);
      }),
    ));
});
