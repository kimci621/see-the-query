import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { touchedOf } from '@/features/editor/touched';
import { parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия scan', () => {
  it('строки таблицы с ctid в lineage и типами колонок', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const scan = stageOf(await traceSql(db, 'select * from book'), 'scan');
        expect(scan).toMatchObject({ alias: 'book', tableId: 'public.book', caption: 'FROM book: 11 строк' });
        expect(scan.output.rows).toHaveLength(11);
        expect(scan.output.rows[0]).toMatchObject({ key: 'book=(0,1)', lineage: { book: '(0,1)' } });
        expect(scan.output.columns.map((c) => `${c.name}:${c.type}`)).toEqual([
          'book_id:bigint',
          'title:text',
          'author_id:bigint',
          'category_id:integer',
          'price:numeric',
          'pages:integer',
          'published_at:date',
          'tags:text[]',
          'meta:jsonb',
        ]);
      }),
    ));
  it('алиас в кавычках сохраняет регистр', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select * from book as "B"');
        expect(trace.mode).toBe('full');
        expect(stageOf(trace, 'scan').output.rows[0].key).toBe('B=(0,1)');
      }),
    ));
  it('источник и строки соответствуют search_path при одинаковых именах таблиц', () =>
    withDataset('empty', (db) =>
      inPreview(db, async () => {
        await db.exec(`
          create schema library;
          create table public.book (title text);
          create table library.book (title text);
          insert into public.book values ('public');
          insert into library.book values ('library');
          set search_path = library, public;
        `);
        const sql = 'select * from book';
        const expected = await db.query(sql);
        const trace = await traceSql(db, sql);
        expect(trace.mode).toBe('full');
        expect(trace.result?.rows).toEqual(expected.rows);
        expect(stageOf(trace, 'scan')).toMatchObject({ tableId: 'library.book' });
        expect(trace.touched.tableIds).toEqual(['library.book']);
        const parsed = parseSql(sql);
        if (!parsed.ok) throw new Error(parsed.error.message);
        expect(touchedOf(parsed.statements[0], await introspect(db)).tableIds).toEqual(['library.book']);

        const update = await traceSql(db, "update book set title = 'changed'");
        expect(stageOf(update, 'dml').tableId).toBe('library.book');
        const rename = await traceSql(db, 'alter table book rename column title to name');
        expect(stageOf(rename, 'ddl').diff.renamedColumns).toEqual([
          { tableId: 'library.book', from: 'title', to: 'name' },
        ]);

        await db.query('set search_path = public, library');
        const changed = await traceSql(db, sql);
        expect(stageOf(changed, 'scan').tableId).toBe('public.book');
        expect(changed.result?.rows).toEqual((await db.query(sql)).rows);

        const explicit = await traceSql(db, 'select * from library.book');
        expect(stageOf(explicit, 'scan').tableId).toBe('library.book');

        await db.exec("create temp table book (title text); insert into book values ('temporary');");
        const temporary = await traceSql(db, sql);
        expect(stageOf(temporary, 'scan').tableId).toBe('pg_temp.book');
        expect(temporary.result?.rows).toEqual((await db.query(sql)).rows);
      }),
    ));
});
