import { describe, expect, it } from 'vitest';
import { withDataset } from '../helpers/db';

const one = async (db: import('@/features/db/types').DbClient, sql: string) => (await db.query(sql)).rows;

describe('датасет events', () => {
  it('события заказов и их число по видам', () =>
    withDataset('events', async (db) => {
      expect(await one(db, 'select count(*)::int from event')).toEqual([[21]]);
      expect(await one(db, "select count(*)::int from event where kind = 'paid'")).toEqual([[7]]);
    }));

  it('число событий по заказам', () =>
    withDataset('events', async (db) => {
      expect(
        await one(db, 'select order_id::int, count(*)::int from event group by order_id order by order_id'),
      ).toEqual([
        [1, 3],
        [2, 2],
        [3, 3],
        [4, 2],
        [5, 3],
        [6, 2],
        [7, 4],
        [8, 2],
      ]);
    }));

  it('особые строки на месте', () =>
    withDataset('events', async (db) => {
      // Одинаковая секунда у платежа и отмены: рамка RANGE против ROWS.
      expect(
        await one(
          db,
          'select count(*)::int from event where order_id = 3 and happened_at = (select max(happened_at) from event where order_id = 3)',
        ),
      ).toEqual([[2]]);
      // Заказ 4 отменён без платежа.
      expect(await one(db, "select count(*)::int from event where order_id = 4 and kind = 'paid'")).toEqual([
        [0],
      ]);
      // Возврат заказа 7 позже доставки.
      expect(
        await one(
          db,
          "select (select happened_at from event where order_id = 7 and kind = 'returned') > (select happened_at from event where order_id = 7 and kind = 'shipped')",
        ),
      ).toEqual([[true]]);
    }));
});
