import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия sort', () => {
  it('DESC NULLS LAST: NULL в конце, ключи для подписи', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sort = stageOf(
          await traceSql(db, 'select title, price from book order by price desc nulls last'),
          'sort',
        );
        expect(column(sort, 'price')).toEqual([
          '3200.00',
          '2400.00',
          '1990.00',
          '890.00',
          '610.00',
          '610.00',
          '560.00',
          '420.00',
          '350.00',
          '350.00',
          null,
        ]);
        expect(sort.sortKeys).toEqual(['price DESC NULLS LAST']);
        expect(sort.order).toEqual(sort.output.rows.map((r) => r.key));
        expect(sort.caption).toBe('ORDER BY price DESC NULLS LAST: 11 строк по порядку');
      }),
    ));
  it('по номеру колонки, по алиасу и по колонке вне SELECT', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const byNumber = stageOf(
          await traceSql(db, 'select title, price from book order by 2 desc, title'),
          'sort',
        );
        expect(column(byNumber, 'title').slice(0, 2)).toEqual(['Остров погибших кораблей', 'Изучаем Python']);
        const byAlias = stageOf(
          await traceSql(db, 'select title, price * 2 as p from book order by p'),
          'sort',
        );
        expect(column(byAlias, 'p')[0]).toBe('700.00');
        const hidden = await traceSql(db, 'select title from book order by price desc nulls last');
        expect(hidden.mode).toBe('full');
        expect(column(stageOf(hidden, 'sort'), 'title')[0]).toBe('Изучаем Python');
      }),
    ));
});
