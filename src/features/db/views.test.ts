import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { introspect } from './introspect';
import { matviewLag, viewDefinition } from './views';

describe('представления и снимки', () => {
  it('читает зависимости и сравнивает снимок с текущим запросом', () =>
    withDataset('bookstore', async (db) => {
      await db.exec(`
        create view v_expensive as select book_id, title, price from book where price > 1000;
        create view v_nested as select * from v_expensive;
        create schema extra;
        create view extra.cross_schema as select * from public.v_expensive;
        create temp view temp_books as select * from book;
        create materialized view mv_unpopulated as select * from book with no data;
        create materialized view mv_expensive as select book_id, title, price from book where price > 1000;
      `);
      const schema = await introspect(db);
      const mv = schema.tables.find((table) => table.id === 'public.mv_expensive');
      if (!mv) throw new Error('нет снимка mv_expensive');
      expect(schema.tables.find((table) => table.id === 'public.v_expensive')?.kind).toBe('view');
      expect(mv?.kind).toBe('matview');
      expect(schema.viewDeps).toContainEqual({ viewId: 'public.v_expensive', tableId: 'public.book' });
      expect(schema.viewDeps).toContainEqual({ viewId: 'public.v_nested', tableId: 'public.v_expensive' });
      expect(schema.viewDeps).toContainEqual({ viewId: 'public.mv_expensive', tableId: 'public.book' });
      expect(schema.viewDeps).toContainEqual({ viewId: 'extra.cross_schema', tableId: 'public.v_expensive' });
      expect(schema.viewDeps).toContainEqual({ viewId: 'pg_temp.temp_books', tableId: 'public.book' });
      expect(schema.tables.find((table) => table.id === 'pg_temp.temp_books')).toMatchObject({
        kind: 'view',
        viewDefinition: expect.stringContaining('book'),
      });
      expect(schema.tables.find((table) => table.id === 'public.mv_unpopulated')?.matviewLag).toBeNull();
      expect(await viewDefinition(db, 'public.v_expensive')).toContain('book');
      expect(await viewDefinition(db, 'public.absent')).toBeNull();
      expect(await matviewLag(db, mv)).toBe(0);
      await db.exec("insert into book (title, price) values ('Новая дорогая книга', 5000)");
      expect(await matviewLag(db, mv)).toBe(1);
      await inPreview(db, async () => {
        expect(await matviewLag(db, mv)).toBe(1);
        expect((await db.query('select 1')).rows).toEqual([[1]]);
        expect((await introspect(db)).tables.find((table) => table.id === mv.id)?.matviewLag).toBe(1);
      });
      await db.exec('refresh materialized view mv_expensive');
      expect(await matviewLag(db, mv)).toBe(0);
    }));

  it('учитывает повторы и изменения, а несравнимые типы не ломают транзакцию', () =>
    withDataset('bookstore', async (db) => {
      await db.exec(`
        create table source_values (n int);
        insert into source_values values (1), (1);
        create materialized view mv_values as select n from source_values;
        create materialized view mv_json as select '{"a":1}'::json as value;
        create sequence unsafe_counter;
        create materialized view mv_sequence as select nextval('unsafe_counter') as n;
        delete from source_values where ctid = (select min(ctid) from source_values);
      `);
      const schema = await introspect(db);
      const mv = schema.tables.find((table) => table.id === 'public.mv_values');
      const json = schema.tables.find((table) => table.id === 'public.mv_json');
      const sequence = schema.tables.find((table) => table.id === 'public.mv_sequence');
      if (!mv || !json || !sequence) throw new Error('нет тестовых снимков');
      expect(sequence.matviewLag).toBeNull();
      expect((await db.query('select last_value from unsafe_counter')).rows).toEqual([[1]]);
      expect(await matviewLag(db, mv)).toBe(1);
      await db.query('update source_values set n = 2');
      expect(await matviewLag(db, mv)).toBe(3);
      expect(await matviewLag(db, json)).toBeNull();
      await expect(db.query('savepoint check_no_open_transaction')).rejects.toMatchObject({
        db: { code: '25P01' },
      });
      await inPreview(db, async () => {
        expect(await matviewLag(db, json)).toBeNull();
        expect(await matviewLag(db, sequence)).toBeNull();
        expect((await db.query('select last_value from unsafe_counter')).rows).toEqual([[1]]);
        await db.query('update source_values set n = 3');
        expect((await db.query('select 42')).rows).toEqual([[42]]);
      });
    }));
});
