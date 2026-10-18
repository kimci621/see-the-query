import { describe, expect, it } from 'vitest';
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
});
