import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия limit', () => {
  it('OFFSET и LIMIT: окно и отрезанные строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const limit = stageOf(
          await traceSql(db, 'select title, price from book order by price limit 3 offset 2'),
          'limit',
        );
        expect(limit).toMatchObject({
          limit: 3,
          offset: 2,
          withTies: false,
          caption: 'OFFSET 2, LIMIT 3: осталось 3 из 11 строк',
        });
        expect(limit.kept).toHaveLength(3);
        expect(limit.cut).toHaveLength(8);
        expect(column(limit, 'price')).toEqual(['420.00', '560.00', '610.00']);
      }),
    ));
  it('FETCH FIRST WITH TIES тянет равные строки (депарсер целого запроса теряет WITH TIES)', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select title, price from book order by price fetch first 1 row with ties',
        );
        expect(trace.mode).toBe('full');
        const limit = stageOf(trace, 'limit');
        expect(column(limit, 'price')).toEqual(['350.00', '350.00']);
        expect(limit.caption).toBe('FETCH FIRST 1 WITH TIES: осталось 2 из 11 строк');
        expect(limit.withTies).toBe(true);
      }),
    ));
  it('ничья на границе OFFSET: внутрь окна попадает та строка, что вернул Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book order by price limit 4 offset 1');
        expect(trace.mode).toBe('full');
        expect(column(stageOf(trace, 'limit'), 'title')).toEqual((trace.result?.rows ?? []).map((r) => r[0]));
      }),
    ));
  it('LIMIT ALL, LIMIT 0 и OFFSET без LIMIT', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        expect(stageOf(await traceSql(db, 'select * from book limit all'), 'limit')).toMatchObject({
          limit: null,
          offset: 0,
          kept: expect.any(Array),
        });
        expect(stageOf(await traceSql(db, 'select * from book limit 0'), 'limit').kept).toEqual([]);
        const offset = stageOf(await traceSql(db, 'select title from book offset 9'), 'limit');
        expect(offset).toMatchObject({ limit: null, offset: 9, caption: 'OFFSET 9: осталось 2 из 11 строк' });
      }),
    ));
});
