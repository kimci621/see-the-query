import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия window', () => {
  it('row_number по партициям должностей', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select name, salary, row_number() over (partition by position order by salary) from employee',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const window = stageOf(trace, 'window');
        expect(window.functions).toEqual(['row_number']);
        expect(window.computed).toEqual(['row_number']);
        expect(window.partitions).toHaveLength(6);
        expect(window.output.rows).toHaveLength(8);
        // В каждой партиции нумерация начинается с 1 и идёт подряд
        const numbers = trace.stages.at(-1)?.output.rows.map((row) => Number(row.values[2]));
        expect(numbers?.slice().sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 1, 1, 1, 1, 1, 2, 2]);
      }),
    ));

  it('lag на событиях: первая строка без предыдущей', () =>
    withDataset('events', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select kind, lag(kind) over (order by happened_at) from event where order_id = 3',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const window = stageOf(trace, 'window');
        expect(window.functions).toEqual(['lag']);
        expect(window.output.rows).toHaveLength(3);
        expect(column(window, 'lag')).toContain(null);
      }),
    ));

  it('накопительный sum по заказу 7', () =>
    withDataset('events', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select kind, amount, sum(amount) over (order by happened_at) from event where order_id = 7',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const window = stageOf(trace, 'window');
        expect(column(window, 'sum')).toEqual([null, '2110.00', '2110.00', '2110.00']);
        expect(trace.result?.rows.map((row) => row[2])).toEqual([null, '2110.00', '2110.00', '2110.00']);
      }),
    ));

  it('RANGE включает ровесников, ROWS считает физические строки', () =>
    withDataset('events', (db) =>
      inPreview(db, async () => {
        const range = await traceSql(
          db,
          'select kind, count(*) over (order by happened_at range between unbounded preceding and current row) from event where order_id = 3',
        );
        expect(range.mode, range.fallbackReason).toBe('full');
        expect(column(stageOf(range, 'window'), 'count').map(Number).sort()).toEqual([1, 3, 3]);
        const rows = await traceSql(
          db,
          'select kind, count(*) over (order by happened_at rows between unbounded preceding and current row) from event where order_id = 3',
        );
        expect(rows.mode, rows.fallbackReason).toBe('full');
        expect(stageOf(rows, 'window').frame).toBe('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
        expect(column(stageOf(rows, 'window'), 'count').map(Number).sort()).toEqual([1, 2, 3]);
      }),
    ));
});
