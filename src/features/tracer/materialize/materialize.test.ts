import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия materialize', () => {
  it('CTE пишется в TEMP-таблицу, внешний SELECT читает её', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `with python_books as (select book_id, title from book where tags @> '{python}')
           select count(*) from python_books`,
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const materialize = stageOf(trace, 'materialize');
        expect(materialize.name).toBe('python_books');
        expect(materialize.source).toBe('cte');
        expect(materialize.output.rows).toHaveLength(3);
        expect(materialize.inner.stages.map((stage) => stage.kind)).toEqual(['scan', 'filter', 'project']);
        const scan = trace.stages.find((stage) => stage.kind === 'scan');
        expect(scan?.kind === 'scan' ? scan.alias : null).toBe('python_books');
        expect(scan?.output.rows).toHaveLength(3);
        expect(scan).toMatchObject({ sourceName: 'python_books', caption: 'FROM python_books: 3 строки' });
        expect(trace.result?.rows).toEqual([[3]]);
      }),
    ));

  it('псевдоним CTE не раскрывает имя временной таблицы', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'with chosen as (select book_id from book where book_id = 1) select c.book_id from chosen c',
        );
        const scan = trace.stages.find((stage) => stage.kind === 'scan');
        expect(scan).toMatchObject({
          sourceName: 'chosen',
          alias: 'c',
          caption: 'FROM chosen AS c: 1 строка',
        });
      }),
    ));

  it('сжатая сцена сохраняет имя источника и псевдоним', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'with chosen as (select book_id from book) select c.book_id from chosen c',
          { maxRows: 2 },
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const scan = trace.stages.find((stage) => stage.kind === 'scan');
        expect(scan).toMatchObject({
          sourceName: 'chosen',
          alias: 'c',
          compressed: true,
          caption: 'FROM chosen AS c: 11 строк',
        });
      }),
    ));

  it('второй CTE видит первый', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `with a as (select author_id from author where country = 'Россия'),
                b as (select count(*) as n from a)
           select n from b`,
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const names = trace.stages
          .filter((stage) => stage.kind === 'materialize')
          .map((stage) => (stage.kind === 'materialize' ? stage.name : ''));
        expect(names).toEqual(['a', 'b']);
        expect(trace.result?.rows).toEqual([[4]]);
      }),
    ));

  it('подзапрос в FROM материализуется и читается как источник', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `select p.title, p.price
           from (select title, price from book where price > 800) p
           order by p.price desc`,
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const materialize = stageOf(trace, 'materialize');
        expect(materialize.name).toBe('p');
        expect(materialize.source).toBe('from');
        expect(materialize.inner.stages.map((stage) => stage.kind)).toEqual(['scan', 'filter', 'project']);
        expect(materialize.output.rows).toHaveLength(4);
        expect(trace.result?.rows.map((row) => row[1])).toEqual(['3200.00', '2400.00', '1990.00', '890.00']);
      }),
    ));

  it('VALUES в FROM становится таблицей из воздуха', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, "select * from (values (1, 'a'), (2, 'b')) as t(n, s) order by n");
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const materialize = stageOf(trace, 'materialize');
        expect(materialize.name).toBe('t');
        expect(materialize.source).toBe('from');
        expect(materialize.output.columns.map((c) => c.name)).toEqual(['n', 's']);
        expect(trace.result?.rows).toEqual([
          [1, 'a'],
          [2, 'b'],
        ]);
      }),
    ));

  it('generate_series в FROM размножает строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select n, n * n from generate_series(1, 4) as n');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(stageOf(trace, 'materialize').name).toBe('n');
        expect(trace.result?.rows).toEqual([
          [1, 1],
          [2, 4],
          [3, 9],
          [4, 16],
        ]);
      }),
    ));

  it('NOT MATERIALIZED пока уходит в final-only с причиной', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'with a as not materialized (select author_id from author) select count(*) from a',
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.fallbackReason).toContain('NOT MATERIALIZED');
      }),
    ));
});
