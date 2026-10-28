import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('каскады FK', () => {
  it('ON DELETE CASCADE: удаление заказа уносит его позиции', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'delete from orders where order_id = 1');
        const dml = stageOf(trace, 'dml');
        expect(dml.deleted).toEqual(['orders=(0,1)']);
        expect(dml.cascades).toEqual([
          { tableId: 'public.order_item', deleted: ['order_item=(0,1)', 'order_item=(0,2)'], updated: [] },
        ]);
      }),
    ));

  it('NO ACTION: автора с книгами удалить нельзя, 23503, каскадов нет', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'delete from author where author_id = 1');
        expect(trace.error?.code).toBe('23503');
        expect(stageOf(trace, 'error').output.rows).toEqual([]);
      }),
    ));

  it('ON DELETE SET NULL: строки остаются, ключ по старому ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table p (id int primary key)');
        await db.query('create temp table c (id int primary key, p_id int references p on delete set null)');
        await db.query('insert into p values (1), (2)');
        await db.query('insert into c values (10, 1), (11, 2)');
        const trace = await traceSql(db, 'delete from p where id = 1');
        expect(stageOf(trace, 'dml').cascades).toEqual([
          { tableId: 'pg_temp.c', deleted: [], updated: ['c=(0,1)'] },
        ]);
      }),
    ));

  it('SET NULL без первичного ключа оставляет запрос в final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table p (id int primary key)');
        await db.query('create temp table c (p_id int references p on delete set null)');
        await db.query('insert into p values (1)');
        await db.query('insert into c values (1)');
        const trace = await traceSql(db, 'delete from p where id = 1');
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rowCount).toBe(1);
      }),
    ));

  it('ON UPDATE CASCADE: строка потомка остаётся, ключ по старому ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table p (id int primary key)');
        await db.query('create temp table c (id int primary key, p_id int references p on update cascade)');
        await db.query('insert into p values (1)');
        await db.query('insert into c values (10, 1)');
        const trace = await traceSql(db, 'update p set id = 2 where id = 1');
        expect(stageOf(trace, 'dml').cascades).toEqual([
          { tableId: 'pg_temp.c', deleted: [], updated: ['c=(0,1)'] },
        ]);
      }),
    ));

  it('каскад проходит по цепочке зависимостей', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table p (id int primary key)');
        await db.query('create temp table c (id int primary key, p_id int references p on delete cascade)');
        await db.query('create temp table d (id int primary key, c_id int references c on delete cascade)');
        await db.query('insert into p values (1)');
        await db.query('insert into c values (10, 1)');
        await db.query('insert into d values (100, 10)');
        const trace = await traceSql(db, 'delete from p where id = 1');
        expect(stageOf(trace, 'dml').cascades).toEqual([
          { tableId: 'pg_temp.c', deleted: ['c=(0,1)'], updated: [] },
          { tableId: 'pg_temp.d', deleted: ['d=(0,1)'], updated: [] },
        ]);
      }),
    ));
});
