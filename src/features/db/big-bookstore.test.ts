import { describe, expect, it } from 'vitest';
import { withDataset } from '../../../tests/helpers/db';

describe('датасет big_bookstore', () => {
  it('содержит объёмы и данные для уроков об индексах', async () => {
    await withDataset('big_bookstore', async (db) => {
      const sizes = await db.query(
        'select (select count(*) from book)::int, (select count(*) from orders)::int, (select count(*) from customer)::int, (select count(*) from author)::int',
      );
      expect(sizes.rows[0]).toEqual([100000, 100000, 20000, 2000]);
      const statuses = await db.query(
        'select status::text, count(*)::int from orders group by status order by orders.status',
      );
      expect(statuses.rows).toEqual([
        ['new', 3000],
        ['paid', 67000],
        ['shipped', 25000],
        ['cancelled', 5000],
      ]);
      const anchors = await db.query(
        "select (select count(*) from orders where customer_id = 42)::int, (select count(*) from orders where created_at >= '2023-06-01 00:00+03' and created_at < '2023-06-02 00:00+03')::int",
      );
      expect(anchors.rows[0]).toEqual([5, 288]);
      const customers = await db.query(
        "select count(distinct customer_id)::int from orders where status = 'new'",
      );
      expect(customers.rows[0]).toEqual([600]);
      expect((await db.query('select email from customer where customer_id = 42')).rows[0]).toEqual([
        'User42@Example.com',
      ]);
      const books = await db.query(
        "select count(*) filter (where title like '%Python%')::int, count(*) filter (where title like '%кошках%')::int, count(*) filter (where tags @> array['python'])::int, count(*) filter (where meta->>'lang' = 'en')::int from book",
      );
      expect(books.rows[0]).toEqual([16667, 16666, 25000, 10000]);
    });
  }, 60_000);
});
