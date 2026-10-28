import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { introspect } from './introspect';

const T = 20000;

describe('introspect на bookstore', () => {
  it(
    'таблицы, число строк и FK',
    async () => {
      const s = await withDataset('bookstore', (db) => introspect(db));
      expect(s.schemas).toEqual(['public']);
      expect(s.tables.map((t) => [t.id, t.kind, t.rowCount])).toEqual([
        ['public.author', 'table', 6],
        ['public.book', 'table', 11],
        ['public.book_category', 'table', 6],
        ['public.customer', 'table', 6],
        ['public.employee', 'table', 8],
        ['public.order_item', 'table', 15],
        ['public.orders', 'table', 8],
        ['public.review', 'table', 10],
      ]);
      expect(s.fks.find((f) => f.name === 'order_item_order_id_fkey')).toEqual({
        name: 'order_item_order_id_fkey',
        from: { tableId: 'public.order_item', columns: ['order_id'] },
        to: { tableId: 'public.orders', columns: ['order_id'] },
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      });
      expect(s.fks).toHaveLength(9);
      expect(s.sequences.find((q) => q.name === 'book_book_id_seq')).toEqual({
        schema: 'public',
        name: 'book_book_id_seq',
        lastValue: 11,
      });
    },
    T,
  );

  it(
    'колонки: PK, identity, default, CHECK, UNIQUE, FK',
    async () => {
      const s = await withDataset('bookstore', (db) => introspect(db));
      const col = (table: string, name: string) =>
        s.tables.find((t) => t.name === table)?.columns.find((c) => c.name === name);
      expect(col('book', 'book_id')).toMatchObject({
        type: 'bigint',
        isPk: true,
        identity: 'always',
        nullable: false,
        default: null,
      });
      expect(col('book', 'price')).toMatchObject({ type: 'numeric(10,2)', nullable: true, fk: null });
      expect(col('book', 'tags')).toMatchObject({ type: 'text[]', default: `'{}'::text[]` });
      expect(col('book', 'author_id')?.fk).toEqual({
        schema: 'public',
        table: 'author',
        column: 'author_id',
      });
      expect(col('customer', 'email')).toMatchObject({ isUnique: true });
      expect(col('customer', 'bonus')?.checks).toEqual(['CHECK ((bonus >= 0))']);
      expect(s.tables.find((t) => t.id === 'public.customer')).toMatchObject({
        constraints: expect.arrayContaining([
          { name: 'customer_email_key', kind: 'u', columns: ['email'] },
          { name: 'customer_bonus_check', kind: 'c', columns: ['bonus'] },
        ]),
      });
      expect(col('order_item', 'order_id')).toMatchObject({ isPk: true, isUnique: false });
      expect(s.tables.find((t) => t.name === 'order_item')?.indexes).toEqual([
        {
          name: 'order_item_pkey',
          definition:
            'CREATE UNIQUE INDEX order_item_pkey ON public.order_item USING btree (order_id, book_id)',
          unique: true,
          primary: true,
        },
      ]);
    },
    T,
  );

  it(
    'первые строки идут по ctid, а не по тексту ctid',
    async () => {
      const s = await withDataset('bookstore', (db) => introspect(db, { sampleRows: 12 }));
      const book = s.tables.find((t) => t.name === 'book');
      expect(book?.sampleCtids.slice(0, 3)).toEqual(['(0,1)', '(0,2)', '(0,3)']);
      expect(book?.sampleRows[0].slice(0, 2)).toEqual([1, 'Тихий Дон']);
      const items = s.tables.find((t) => t.name === 'order_item');
      expect(items?.sampleCtids).toHaveLength(12);
      expect(items?.sampleCtids[9]).toBe('(0,10)');
    },
    T,
  );

  it(
    'view, matview и временная таблица',
    async () => {
      await withDataset('bookstore', (db) =>
        inPreview(db, async () => {
          await db.exec(`
          create view cheap as select title from book where price < 500;
          create materialized view top as select title from book order by price desc nulls last limit 2 with no data;
          create temp table draft (id int);
          comment on view cheap is 'Дешёвые книги';`);
          const s = await introspect(db);
          const t = (name: string) => s.tables.find((x) => x.name === name);
          expect(t('cheap')).toMatchObject({
            id: 'public.cheap',
            kind: 'view',
            rowCount: 3,
            sampleCtids: ['row:0', 'row:1', 'row:2'],
            comment: 'Дешёвые книги',
          });
          expect(t('top')).toMatchObject({ kind: 'matview', rowCount: 0, sampleRows: [] });
          expect(t('draft')).toMatchObject({ id: 'pg_temp.draft', schema: 'pg_temp', kind: 'temp' });
          expect(s.schemas).toEqual(['public']);
        }),
      );
    },
    T,
  );
});
