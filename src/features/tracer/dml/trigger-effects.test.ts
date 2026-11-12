import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

const setup = `
  create table product (id int primary key, price int not null);
  create table price_log (product_id int, old_price int, new_price int, changed_at timestamptz default now());
  insert into product values (1, 10), (2, 20);
  create function log_price() returns trigger language plpgsql as $$
  begin
    insert into price_log (product_id, old_price, new_price) values (new.id, old.price, new.price);
    return new;
  end $$;
  create trigger price_changed after update on product for each row
    when (old.price is distinct from new.price) execute function log_price();
`;

describe('фактические побочные изменения при триггерах', () => {
  it('фиксирует добавленные строки и совпадает с прямым выполнением', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      const sql = 'update product set price = price + 1 where id = 1 returning id, price';
      const direct = await inPreview(db, async () => {
        const result = await db.query(sql);
        const log = await db.query('select product_id, old_price, new_price from price_log');
        return { result: result.rows, log: log.rows };
      });
      await inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual(direct.result);
        const effects = stageOf(trace, 'dml').triggerEffects;
        expect(effects).toHaveLength(1);
        expect(effects?.[0].tableId).toBe('public.price_log');
        expect(effects?.[0].candidates).toContain('price_changed');
        expect(effects?.[0].added.rows.map((row) => row.values.slice(0, 3))).toEqual(direct.log);
        expect(effects?.[0].added.rows[0].values[3]).toBeInstanceOf(Date);
      });
      expect((await db.query('select count(*) from price_log')).rows[0][0]).toBe(0);
    });
  });

  it('не добавляет эффект, если условие триггера не выполнено', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'update product set price = price where id = 1');
        expect(stageOf(trace, 'dml').triggerEffects ?? []).toEqual([]);
      });
    });
  });

  it('изменение существующей строки оставляет честный итог и не выполняет запрос повторно', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table product (id int primary key, price int);
        insert into product values (1, 10);
        create table counter (n int);
        insert into counter values (0);
        create function bump() returns trigger language plpgsql as $$
        begin update counter set n = n + 1; return new; end $$;
        create trigger bump_counter after update on product for each row execute function bump();
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'update product set price = price + 1 where id = 1 returning price');
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[11]]);
        expect((await db.query('select n from counter')).rows).toEqual([[1]]);
      });
    });
  });

  it('учитывает триггер на оператор даже при нуле изменённых строк', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table product (id int primary key, price int);
        create table audit (message text);
        create function audit_stmt() returns trigger language plpgsql as $$
        begin insert into audit values ('готово'); return null; end $$;
        create trigger audit_update after update on product for each statement execute function audit_stmt();
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'update product set price = 1 where id = 42');
        const effects = stageOf(trace, 'dml').triggerEffects;
        expect(effects?.[0].added.rows.map((row) => row.values)).toEqual([['готово']]);
      });
    });
  });

  it('не скрывает создание таблицы внутри триггера', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table product (id int primary key, price int);
        insert into product values (1, 10);
        create function create_extra() returns trigger language plpgsql as $$
        begin execute 'create table extra (id int)'; return new; end $$;
        create trigger create_extra_table after update on product for each row execute function create_extra();
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'update product set price = price + 1 where id = 1 returning price');
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[11]]);
        expect((await db.query("select to_regclass('public.extra') is not null")).rows).toEqual([[true]]);
      });
    });
  });

  it('не скрывает дополнительные строки в целевой таблице', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table product (id int primary key, price int);
        create function add_another() returns trigger language plpgsql as $$
        begin if new.id = 1 then insert into product values (2, 20); end if; return new; end $$;
        create trigger add_extra after insert on product for each row execute function add_another();
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'insert into product values (1, 10) returning id');
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[1]]);
        expect((await db.query('select id from product order by id')).rows).toEqual([[1], [2]]);
      });
    });
  });

  it('не показывает побочных строк для отключённого триггера', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await db.query('alter table product disable trigger price_changed');
      await inPreview(db, async () => {
        const trace = await traceSql(db, 'update product set price = price + 1 where id = 1');
        expect(trace.mode).toBe('full');
        expect(stageOf(trace, 'dml').triggerEffects ?? []).toEqual([]);
        expect((await db.query('select count(*) from price_log')).rows[0][0]).toBe(0);
      });
    });
  });
});
