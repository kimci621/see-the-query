import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('трассировка DELETE', () => {
  it('вердикты WHERE, удалённые строки остаются в output', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'delete from review where rating < 4');
        expect(
          Object.values(stageOf(trace, 'filter').verdicts).filter((value) => value === true),
        ).toHaveLength(2);
        const dml = stageOf(trace, 'dml');
        expect(dml.deleted.map((key) => key.startsWith('review='))).toEqual([true, true]);
        expect(dml.output.rows).toHaveLength(10);
      }),
    ));

  it('DELETE ... USING: вердикты по паре таблиц, ключи цели', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'delete from review r using book b where r.book_id = b.book_id and b.category_id = 6',
        );
        expect(trace.mode).toBe('full');
        expect(stageOf(trace, 'dml').deleted).toHaveLength(2);
        expect(stageOf(trace, 'dml').deleted.every((key) => key.startsWith('r='))).toBe(true);
      }),
    ));
});
