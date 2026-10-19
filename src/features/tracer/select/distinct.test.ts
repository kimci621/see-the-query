import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';
import { rowCanon } from '../verify';

describe('стадия distinct', () => {
  it('DISTINCT: стопки одинаковых значений, NULL в своей стопке', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const distinct = stageOf(await traceSql(db, 'select distinct city from customer'), 'distinct');
        expect(distinct.on).toBeNull();
        expect(distinct.stacks.map((s) => s.members.length).sort()).toEqual([1, 1, 2, 2]);
        expect(distinct.stacks.find((s) => s.winner === 'customer=(0,1)')?.members).toEqual([
          'customer=(0,1)',
          'customer=(0,4)',
        ]);
        expect(column(distinct, 'city')).toEqual(['Москва', 'Казань', null, 'Санкт-Петербург']);
        expect(distinct.caption).toBe('DISTINCT: 6 строк → 4 уникальные');
      }),
    ));
  it('DISTINCT ON: победитель первый по ORDER BY, NULL при DESC первым', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select distinct on (category_id) title, category_id, price from book order by category_id, price desc',
        );
        expect(trace.mode).toBe('full');
        const distinct = stageOf(trace, 'distinct');
        expect(distinct.on).toEqual(['category_id']);
        expect(distinct.stacks.find((s) => s.winner === 'book=(0,7)')?.members).toHaveLength(4);
        expect(column(stageOf(trace, 'sort'), 'title')).toEqual([
          'Остров погибших кораблей',
          'Тихий Дон',
          'Изучаем Python',
          'Простой Python',
        ]);
      }),
    ));
  it('DISTINCT ON по ключу-ключевому слову: подпись без кавычек, в обычном и сжатом режиме', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sql = 'select distinct on (position) name, position from employee order by position';
        for (const maxRows of [undefined, 5]) {
          const trace = await traceSql(db, sql, maxRows ? { maxRows } : {});
          expect(trace.mode, trace.fallbackReason).toBe('full');
          expect(stageOf(trace, 'distinct').caption).toBe(
            'DISTINCT ON (position): 8 строк → 6, по одной на группу',
          );
        }
      }),
    ));
  it('DISTINCT ON без полного порядка: победитель тот, что вернул Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select distinct on (category_id) category_id, title from book order by category_id',
        );
        expect(trace.mode).toBe('full');
        const last = trace.stages[trace.stages.length - 1];
        expect(last.output.rows.map((r) => rowCanon(r.values)).sort()).toEqual(
          (trace.result?.rows ?? []).map(rowCanon).sort(),
        );
      }),
    ));
});
