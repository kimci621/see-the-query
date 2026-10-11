import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../tests/helpers/trace';

describe('traceStatement', () => {
  it('ошибка Postgres → стадия error с фокусом на таблице', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select nme from book');
        expect(trace).toMatchObject({ mode: 'final-only', result: null, error: { code: '42703' } });
        expect(stageOf(trace, 'error').focus.tableIds).toEqual(['public.book']);
        // транзакция превью жива после ошибки
        expect((await db.query('select count(*)::int from book')).rows).toEqual([[11]]);
      }),
    ));
  it('команды транзакций не выполняются', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'rollback');
        expect(trace).toMatchObject({ mode: 'final-only', statementType: 'tcl', result: null, stages: [] });
      }),
    ));
  it('неподдерживаемый оператор: final-only с эталоном и touched', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*) from book');
        expect(trace).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: агрегатные функции',
          stages: [],
        });
        expect(trace.result?.rows).toEqual([[11]]);
        expect(trace.touched.tableIds).toEqual(['public.book']);
      }),
    ));
  it('представление: final-only, у него нет ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create view cheap as select title, price from book where price < 500');
        const trace = await traceSql(db, 'select * from cheap', { schema: await introspect(db) });
        expect(trace).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: представление',
        });
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));
  it('volatile: одно вычисление на все стадии, метка volatile', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, random() as r from book order by r limit 3');
        expect(trace.mode).toBe('full');
        expect(trace.stages.map((s) => `${s.kind}:${s.volatile ?? false}`)).toEqual([
          'scan:false',
          'project:true',
          'sort:true',
          'limit:true',
        ]);
        const r = column(stageOf(trace, 'sort'), 'r') as number[];
        expect([...r].sort((a, b) => a - b)).toEqual(r);
        expect(column(stageOf(trace, 'limit'), 'r')).toEqual(r.slice(0, 3));
      }),
    ));
  it('отменённый signal прерывает трассу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(traceSql(db, 'select * from book', { signal: controller.signal })).rejects.toMatchObject(
          { name: 'AbortError' },
        );
      }),
    ));
});
