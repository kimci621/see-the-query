import { describe, expect, it } from 'vitest';
import { isCompressed } from '@/features/board/compressed';
import { datasetDump, inPreview, withDataset } from '../../../tests/helpers/db';
import { traceSql } from '../../../tests/helpers/trace';
import { introspect } from './introspect';

describe('датасет big_bookstore', () => {
  it('английская версия работает в сжатом режиме и повторно открывается из снимка', async () => {
    const dump = await datasetDump('big_bookstore', 'en');
    expect(await datasetDump('big_bookstore', 'en')).toBe(dump);
    await withDataset(
      'big_bookstore',
      async (db) => {
        expect((await db.query("select count(*)::int from book where title like '%cats%'")).rows).toEqual([
          [16666],
        ]);
        expect((await db.query('select count(*)::int from orders')).rows).toEqual([[100000]]);
        const schema = await introspect(db, { sampleRows: 5 });
        const books = schema.tables.find((table) => table.id === 'public.book');
        expect(books && isCompressed(books)).toBe(true);
        const trace = await inPreview(db, () =>
          traceSql(db, 'select title from book limit 2', { locale: 'en' }),
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.stages.some((stage) => stage.compressed)).toBe(true);
      },
      'en',
    );
    await withDataset(
      'big_bookstore',
      async (db) => {
        expect((await db.query('select count(*)::int from book')).rows).toEqual([[100000]]);
      },
      'en',
    );
  }, 90000);

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
