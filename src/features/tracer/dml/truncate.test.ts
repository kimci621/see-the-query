import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('TRUNCATE', () => {
  it('таблица пустеет, все строки в deleted', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'truncate review');
        const dml = stageOf(trace, 'dml');
        expect(dml.op).toBe('truncate');
        expect(dml.deleted).toHaveLength(10);
      }),
    ));

  it('на таблицу ссылаются: 0A000 без CASCADE', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'truncate author');
        expect(stageOf(trace, 'error').error.code).toBe('0A000');
      }),
    ));

  it('несколько таблиц: final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        expect((await traceSql(db, 'truncate review, order_item')).mode).toBe('final-only');
      }),
    ));

  it('CASCADE очищает зависимые таблицы', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'truncate orders cascade');
        expect(stageOf(trace, 'dml').cascades).toEqual([
          expect.objectContaining({ tableId: 'public.order_item', updated: [] }),
        ]);
      }),
    ));
});
