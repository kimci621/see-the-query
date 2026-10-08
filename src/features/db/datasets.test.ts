import { describe, expect, it } from 'vitest';
import { withDataset } from '../../../tests/helpers/db';
import { loadDatasetSql } from './datasets';

const one = async (db: import('./types').DbClient, sql: string) => (await db.query(sql)).rows;

describe('датасет bookstore', () => {
  it('загрузчик находит SQL, неизвестный датасет даёт понятную ошибку', async () => {
    expect(await loadDatasetSql('bookstore')).toContain('create table book');
    await expect(loadDatasetSql('events')).rejects.toThrow('Датасет events не найден');
  });

  it('число строк совпадает с docs/datasets.md', async () => {
    await withDataset('bookstore', async (db) => {
      const counts = await one(
        db,
        `select relname::text, (xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || relname, false, true, '')))[1]::text::int
         from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by 1`,
      );
      expect(Object.fromEntries(counts)).toEqual({
        author: 6,
        book: 11,
        book_category: 6,
        customer: 6,
        employee: 8,
        order_item: 15,
        orders: 8,
        review: 10,
      });
    });
  }, 20000);

  it('особые строки на месте', async () => {
    await withDataset('bookstore', async (db) => {
      expect(
        await one(
          db,
          'select a.name from author a left join book b using (author_id) where b.book_id is null',
        ),
      ).toEqual([['Борис Пастернак']]);
      expect(
        await one(
          db,
          'select b.title from book b left join order_item oi using (book_id) where oi.order_id is null',
        ),
      ).toEqual([['Остров погибших кораблей']]);
      expect(await one(db, 'select title from book where price is null')).toEqual([
        ['Остров погибших кораблей'],
      ]);
      expect(await one(db, 'select title from book where author_id is null order by book_id')).toEqual([
        ['Простой Python'],
        ['Изучаем Python'],
      ]);
      expect(
        await one(
          db,
          'select c.name from customer c left join orders o using (customer_id) where o.order_id is null',
        ),
      ).toEqual([['Елена Козлова']]);
      expect(await one(db, 'select name from customer where city is null')).toEqual([['Мария Иванова']]);
      expect(await one(db, `select count(*)::int from customer where name = 'Иван Петров'`)).toEqual([[2]]);
      expect(
        await one(
          db,
          `select (created_at at time zone 'Europe/Moscow')::date::text, (created_at at time zone 'UTC')::date::text from orders where order_id = 7`,
        ),
      ).toEqual([['2024-05-01', '2024-04-30']]);
      expect(
        await one(
          db,
          'select e.name from employee e join employee m on m.employee_id = e.manager_id where e.salary > m.salary',
        ),
      ).toEqual([['Алексей Морозов']]);
      expect(
        await one(
          db,
          `select c.name from book_category c where not exists (select 1 from book b join book_category s on s.category_id = b.category_id where s.category_id = c.category_id or s.parent_id = c.category_id)`,
        ),
      ).toEqual([['Литература по фотографии']]);
      expect(
        await one(
          db,
          `select price::text, string_agg(title, ', ' order by title) from book group by price having count(*) > 1 order by price`,
        ),
      ).toEqual([
        ['350.00', 'Сказка о рыбаке и рыбке, Судьба человека'],
        ['610.00', 'Дети капитана Гранта, Путешествие к центру Земли'],
      ]);
      expect(
        await one(
          db,
          `select salary::text, string_agg(name, ', ' order by name) from employee group by salary having count(*) > 1`,
        ),
      ).toEqual([['70000.00', 'Игорь Новиков, Наталья Лебедева']]);
      expect(
        await one(
          db,
          `with recursive t as (
             select employee_id, name, 1 as lvl from employee where manager_id is null
             union all
             select e.employee_id, e.name, t.lvl + 1 from employee e join t on e.manager_id = t.employee_id)
           select name, lvl from t order by lvl desc limit 1`,
        ),
      ).toEqual([['Татьяна Зайцева', 4]]);
    });
  }, 20000);
});
