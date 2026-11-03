import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('подзапросы', () => {
  it('скалярный подзапрос в SELECT даёт одно значение', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select title, (select max(price) from book) as max_price from book',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('scalar');
        expect(subquery.value).toBe('3200.00');
        expect(trace.result?.rows).toHaveLength(11);
        expect(trace.stages.at(-1)?.output.rows[0].values[1]).toBe('3200.00');
      }),
    ));

  it('IN в WHERE оставляет совпавшие строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `select title from book
           where category_id in (select category_id from book_category where parent_id = 1)`,
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('in');
        expect(Object.values(subquery.verdicts ?? {}).filter(Boolean)).toHaveLength(8);
        expect(trace.result?.rows).toHaveLength(8);
      }),
    ));

  it('NOT IN с NULL в подзапросе даёт UNKNOWN и ноль строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select name from author where author_id not in (select author_id from book)',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('in');
        expect(
          Object.values(subquery.verdicts ?? {}).every((value) => value === false || value === null),
        ).toBe(true);
        expect(trace.result?.rows).toEqual([]);
      }),
    ));

  it('коррелированный EXISTS: до трёх внутренних сцен', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select title from book b where exists (select 1 from review r where r.book_id = b.book_id)',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('exists');
        expect(subquery.samples).toHaveLength(3);
        expect(trace.result?.rows).toHaveLength(7);
      }),
    ));

  it('коррелированный скалярный: средняя по автору', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select title from book b where price > (select avg(price) from book where author_id = b.author_id)',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('correlated');
        expect(subquery.samples).toHaveLength(3);
        expect(trace.result?.rows).toHaveLength(2);
      }),
    ));

  it('ANY и ALL с подзапросом дают вердикты по строкам', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const any = await traceSql(
          db,
          'select title from book where price > any (select price from book where category_id = 6)',
        );
        expect(any.mode, any.fallbackReason).toBe('full');
        const anyStage = stageOf(any, 'subquery');
        expect(anyStage.mode).toBe('any');
        expect(any.result?.rows).toHaveLength(1);
        const all = await traceSql(
          db,
          'select title from book where price > all (select price from book where category_id = 6)',
        );
        expect(all.mode, all.fallbackReason).toBe('full');
        const allStage = stageOf(all, 'subquery');
        expect(allStage.mode).toBe('all');
        expect(all.result?.rows).toEqual([]);
      }),
    ));

  it('LATERAL даёт мини-сцены и склеенный итог', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `select a.name, t.title
           from author a,
                lateral (select title from book b where b.author_id = a.author_id order by price desc nulls last limit 1) t
           order by a.name`,
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('lateral');
        expect(subquery.samples).toHaveLength(3);
        expect(subquery.limit3).toBe(true);
        expect(trace.result?.rows).toHaveLength(5);
        expect(trace.stages.at(-1)?.output.rows).toHaveLength(5);
      }),
    ));

  it('некоррелированный EXISTS отмечает все строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select title from book where exists (select 1 from review where rating = 5)',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const subquery = stageOf(trace, 'subquery');
        expect(subquery.mode).toBe('exists');
        expect(Object.values(subquery.verdicts ?? {}).every(Boolean)).toBe(true);
        expect(trace.result?.rows).toHaveLength(11);
      }),
    ));
});
