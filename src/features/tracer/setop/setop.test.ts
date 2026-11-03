import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия setop', () => {
  it('UNION схлопывает дубли и держит обе ветви', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select name from author where country = 'Россия' union select name from author where born_year < 1830",
        );
        expect(trace.mode).toBe('full');
        const setop = stageOf(trace, 'setop');
        expect(setop.op).toBe('union');
        expect(setop.output.rows).toHaveLength(5);
        expect(setop.branches.map((branch) => branch.mode)).toEqual(['full', 'full']);
        expect(setop.branches[0].stages).toHaveLength(3);
        expect(setop.branches[1].stages).toHaveLength(3);
      }),
    ));

  it('UNION ALL оставляет все вхождения, UNION - по одному', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const all = await traceSql(
          db,
          'select rating from review where rating >= 4 union all select rating from review where rating >= 4',
        );
        expect(stageOf(all, 'setop').op).toBe('union all');
        expect(stageOf(all, 'setop').output.rows).toHaveLength(16);
        const distinct = await traceSql(
          db,
          'select rating from review where rating >= 4 union select rating from review where rating >= 4',
        );
        expect(stageOf(distinct, 'setop').output.rows).toHaveLength(2);
      }),
    ));

  it('INTERSECT оставляет общие строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select title from book where tags @> '{фантастика}' intersect select title from book where tags @> '{приключения}'",
        );
        expect(stageOf(trace, 'setop').output.rows.map((row) => row.values[0])).toEqual([
          'Остров погибших кораблей',
          'Путешествие к центру Земли',
        ]);
      }),
    ));

  it('EXCEPT ALL вычитает по одному вхождению', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, '(select 4 union all select 4) except all select 4');
        const setop = stageOf(trace, 'setop');
        expect(setop.op).toBe('except all');
        expect(setop.output.rows.map((row) => row.values[0])).toEqual([4]);
      }),
    ));

  it('ORDER BY над множеством сортирует готовый итог отдельной стадией', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select 2 union select 1 order by 1');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.stages.map((s) => s.kind)).toEqual(['setop', 'sort']);
        expect(trace.stages.at(-1)?.output.rows.map((row) => row.values)).toEqual([[1], [2]]);
        expect(trace.result?.rows).toEqual([[1], [2]]);
      }),
    ));
});
