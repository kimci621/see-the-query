import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';

const queries = [
  {
    sql: 'select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5',
    stages: 'scan:11 > expand:21 > filter:3 > project:3',
  },
  {
    sql: 'select c.customer_id, s.key, s.value from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 1',
    stages: 'scan:6 > expand:7 > filter:2 > project:2',
  },
  {
    sql: 'select u.tag, count(*) from book b, unnest(b.tags) as u(tag) group by u.tag order by u.tag',
    stages: 'scan:11 > expand:21 > group:10 > project:10 > sort:10',
  },
  {
    sql: 'with chosen as (select book_id, tags from book where book_id = 5) select c.book_id, u.tag from chosen c, unnest(c.tags) as u(tag)',
    stages: 'materialize:1 > scan:1 > expand:3 > project:3',
  },
  {
    sql: "select e.elem from (values ('[1,2,3]'::jsonb)) as j (doc), jsonb_array_elements(j.doc) as e (elem)",
    stages: 'materialize:1 > scan:1 > expand:3 > project:3',
  },
];

describe('golden Ф11: раскрытие массивов и JSON', () => {
  it.each(queries)('$sql', ({ sql, stages }) =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(stages);
      }),
    ),
  );
});

describe('golden Ф11: побочные изменения при триггерах', () => {
  it('сравнивает RETURNING и журнал с прямым выполнением PostgreSQL', async () => {
    await withDataset('bookstore', async (db) => {
      await db.exec(`
        create table price_log (book_id bigint, old_price numeric, new_price numeric);
        create function record_price() returns trigger language plpgsql as $$
        begin
          insert into price_log values (new.book_id, old.price, new.price);
          return new;
        end $$;
        create trigger price_changed after update on book for each row
        when (old.price is distinct from new.price) execute function record_price();
      `);
      const sql = 'update book set price = price + 10 where book_id = 1 returning book_id, price';
      const direct = await inPreview(db, async () => {
        const result = await db.query(sql);
        const log = await db.query('select book_id, old_price, new_price from price_log');
        return { result: result.rows, log: log.rows };
      });
      await inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual(direct.result);
        const stage = trace.stages.find((item) => item.kind === 'dml');
        expect(stage?.kind).toBe('dml');
        if (stage?.kind !== 'dml') throw new Error('Нет стадии DML');
        expect(stage.triggerEffects?.[0].added.rows.map((row) => row.values)).toEqual(direct.log);
      });
    });
  });
});

describe('golden Ф11: маршрутизация вставки', () => {
  it('секции и RETURNING совпадают с прямым выполнением PostgreSQL', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table readings (id int, day date) partition by range (day);
        create table readings_may partition of readings for values from ('2024-05-01') to ('2024-06-01');
        create table readings_june partition of readings for values from ('2024-06-01') to ('2024-07-01');
      `);
      const sql = "insert into readings values (1, '2024-05-10'), (2, '2024-06-15') returning id, day";
      const direct = await inPreview(db, async () => {
        const result = await db.query(sql);
        const rows = await db.query('select tableoid::regclass::text, id, day from readings order by id');
        return { result: result.rows, rows: rows.rows };
      });
      await inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual(direct.result);
        const stage = trace.stages.find((item) => item.kind === 'dml');
        if (stage?.kind !== 'dml') throw new Error('Нет стадии DML');
        expect(
          stage.routing?.flatMap((group) =>
            group.added.rows.map((row) => [group.partitionId.split('.').at(-1), ...row.values]),
          ),
        ).toEqual(direct.rows);
      });
    });
  });
});
