import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { traceSql } from '../../../tests/helpers/trace';

describe('стадия expand', () => {
  it('unnest раскрывает теги каждой книги до фильтра', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.stages.map((stage) => stage.kind)).toEqual(['scan', 'expand', 'filter', 'project']);
        const expand = trace.stages.find((stage) => stage.kind === 'expand');
        expect(expand).toMatchObject({ fn: 'unnest', alias: 'u', sourceAlias: 'b', sourceColumn: 'tags' });
        expect(expand?.children).toContainEqual({ parent: 'b=(0,5)', keys: ['#1', '#2', '#3'] });
        expect(expand?.children.length).toBe(11);
        expect(trace.result?.rows.map((row) => row[1])).toEqual(['классика', 'сказка', 'детям']);
      }),
    ));

  it('jsonb_each раскрывает настройки покупателя', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select c.customer_id, s.key, s.value from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 1',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const expand = trace.stages.find((stage) => stage.kind === 'expand');
        expect(expand).toMatchObject({
          fn: 'jsonb_each',
          alias: 's',
          sourceAlias: 'c',
          sourceColumn: 'settings',
        });
        expect(expand?.children).toContainEqual({ parent: 'c=(0,1)', keys: ['#1', '#2'] });
        expect(trace.result?.rows).toHaveLength(2);
      }),
    ));

  it('jsonb_array_elements раскрывает документ из VALUES', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select e.elem from (values ('[1,2,3]'::jsonb)) as j (doc), jsonb_array_elements(j.doc) as e (elem)",
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.stages.find((stage) => stage.kind === 'expand')).toMatchObject({
          fn: 'jsonb_array_elements',
          alias: 'e',
          sourceAlias: 'j',
          sourceColumn: 'doc',
          children: [{ parent: 'j=(0,1)', keys: ['#1', '#2', '#3'] }],
        });
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));

  it('сортировка и повторяющиеся значения сохраняют разные строки и родителей', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select b.book_id, u.tag from book b, unnest(b.tags) as u(tag) where u.tag = 'python' order by b.book_id",
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual([
          [2, 'python'],
          [10, 'python'],
          [11, 'python'],
        ]);
        const expand = trace.stages.find((stage) => stage.kind === 'expand');
        expect(
          expand?.output.rows.filter((row) => row.values.includes('python')).map((row) => row.key),
        ).toEqual(['b=(0,2)|u=#1', 'b=(0,10)|u=#1', 'b=(0,11)|u=#1']);
      }),
    ));

  it('имя функции используется как алиас, если алиас не задан', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select unnest.unnest from book b, unnest(b.tags) where b.book_id = 5',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual([['классика'], ['сказка'], ['детям']]);
        expect(trace.stages.find((stage) => stage.kind === 'expand')).toMatchObject({ alias: 'unnest' });
      }),
    ));

  it('WITH ORDINALITY остаётся видимым под указанным именем', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.book_id, u.tag, u.pos from book b, unnest(b.tags) with ordinality as u(tag, pos) where b.book_id = 5',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual([
          [5, 'классика', 1],
          [5, 'сказка', 2],
          [5, 'детям', 3],
        ]);
        const expand = trace.stages.find((stage) => stage.kind === 'expand');
        expect(expand?.children).toContainEqual({ parent: 'b=(0,5)', keys: ['#1', '#2', '#3'] });
      }),
    ));

  it('одинаковые элементы одного массива остаются разными строками', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query("update book set tags = array['x', 'x'] where book_id = 5");
        const trace = await traceSql(
          db,
          'select b.book_id, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual([
          [5, 'x'],
          [5, 'x'],
        ]);
        const expand = trace.stages.find((stage) => stage.kind === 'expand');
        const parent = trace.stages
          .find((stage) => stage.kind === 'scan')
          ?.output.rows.find((row) => row.values[0] === 5)?.key;
        expect(parent).toBeDefined();
        expect(expand?.children).toContainEqual({ parent, keys: ['#1', '#2'] });
      }),
    ));

  it('пустой JSON не создаёт потомков, а неподдержанная функция возвращает итог без сбоя', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const empty = await traceSql(
          db,
          'select c.customer_id, s.key from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 4',
        );
        expect(empty.mode, empty.fallbackReason).toBe('full');
        expect(empty.result?.rows).toEqual([]);
        const expand = empty.stages.find((stage) => stage.kind === 'expand');
        expect(expand?.children.some((child) => child.parent === 'c=(0,4)')).toBe(false);
        const unknown = await traceSql(
          db,
          'select b.book_id, t.key from book b, jsonb_object_keys(b.meta) as t(key) where b.book_id = 1',
        );
        expect(unknown.mode).toBe('final-only');
        expect(unknown.result?.rows).toHaveLength(2);
        expect(unknown.fallbackReason).toContain('jsonb_object_keys');
      }),
    ));

  it('set-returning функция в SELECT показывает только итог с причиной', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select unnest(tags) as tag from book where book_id = 5');
        expect(trace.mode).toBe('final-only');
        expect(trace.fallbackReason).toBe('set-returning функция в списке SELECT');
      }),
    ));
});
