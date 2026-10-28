import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';
import type { Stage } from '../types';

type FilterStage = Extract<Stage, { kind: 'filter' }> & { target?: true };

describe('трассировка UPDATE', () => {
  it('WHERE-вердикты, before/after по колонкам, ключ по старому ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'update book set price = price * 0.9 where price > 800');
        expect(trace.mode).toBe('full');
        const filter = stageOf(trace, 'filter') as FilterStage;
        expect(filter.target).toBe(true);
        expect(Object.values(filter.verdicts).filter((value) => value === true)).toHaveLength(4);
        const dml = stageOf(trace, 'dml');
        expect(dml.updated).toHaveLength(4);
        expect(dml.updated[0]).toMatchObject({ changedColumns: ['price'] });
        expect(dml.updated[0].before[4]).toBe('890.00');
        expect(dml.updated[0].key).toBe('book=(0,1)');
        expect(dml.output.rows).toHaveLength(11);
      }),
    ));

  it('без WHERE стадии filter нет', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'update book set tags = tags');
        expect(trace.stages.map((stage) => stage.kind)).toEqual(['scan', 'dml']);
        expect(stageOf(trace, 'dml').updated).toHaveLength(11);
      }),
    ));

  it('таблица без PK: ключ по ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table t (a int)');
        await db.query('insert into t values (1), (2)');
        const trace = await traceSql(db, 'update t set a = 3 where a = 1');
        expect(stageOf(trace, 'dml').updated.map((item) => item.key)).toEqual(['t=(0,1)']);
      }),
    ));

  it('генерируемая колонка: old.* и new.* режутся по числу колонок', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query(
          'create temp table g (price numeric, qty int, total numeric generated always as (price * qty) stored, note text)',
        );
        await db.query("insert into g (price, qty, note) values (10, 2, 'x')");
        const trace = await traceSql(db, 'update g set qty = 3');
        const updated = stageOf(trace, 'dml').updated[0];
        expect(updated.changedColumns).toEqual(['qty', 'total']);
        expect(updated.after[3]).toBe('x');
      }),
    ));

  it('volatile в WHERE: final-only, оператор выполнен один раз', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sum = async () =>
          (await db.query('select sum(pages)::int, count(pages)::int from book')).rows[0];
        const [before, count] = await sum();
        const trace = await traceSql(db, 'update book set pages = pages + 1 where random() < 2');
        expect(trace.mode).toBe('final-only');
        const [after] = await sum();
        expect((after as number) - (before as number)).toBe(count);
      }),
    ));
});
