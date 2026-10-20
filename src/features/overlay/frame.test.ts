import { describe, expect, it } from 'vitest';
import { BOOKS, bookScan, compressedTrace } from './__fixtures__/traces';
import {
  clearMarks,
  currentTable,
  ghostRows,
  mapRows,
  rebuildTable,
  stageRows,
  totalRows,
  withTable,
} from './frame';
import { COMPRESSED_VISIBLE_ROWS } from './geometry';
import { stageLabel, tableTitle } from './labels';

const base = { id: 't:b', title: 'book', x: 10, y: 20 };

describe('frame', () => {
  it('rebuildTable переносит колонки и строки, порядок по order', () => {
    const t = rebuildTable(base, bookScan().output, ['b=(0,8)', 'b=(0,1)']);
    expect(t.columns.map((c) => c.name)).toEqual(['book_id', 'title', 'price']);
    expect(t.rows.map((r) => r.key).slice(0, 2)).toEqual(['b=(0,8)', 'b=(0,1)']);
    expect(t.rows).toHaveLength(5);
    expect(t.hiddenRows).toBe(0);
  });

  // P8.62: спрятаны колонки левой book, заглушка сразу за её колонками, а не за колонками author
  it('rebuildTable: заглушка свёртки стоит после колонок своей таблицы', () => {
    const col = (alias: string, column: string) => ({
      name: column,
      type: 'text',
      source: { alias, column },
    });
    const joined = {
      columns: [
        col('b', 'book_id'),
        col('b', 'title'),
        col('b', 'pages'),
        col('a', 'author_id'),
        col('a', 'name'),
      ],
      rows: [{ key: 'b=(0,1)+a=(0,1)', lineage: {}, values: [1, 'Дон', 300, 1, 'Шолохов'] }],
    } as Parameters<typeof rebuildTable>[1];
    const t = rebuildTable({ ...base, fold: ['b.pages'] }, joined);
    expect(t.columns.map((c) => c.name)).toEqual(['book_id', 'title', 'author_id', 'name']);
    expect(t.folds).toEqual([{ at: 2, count: 1 }]);
    // свёрнуты обе таблицы (self join): по заглушке на каждую
    const both = rebuildTable({ ...base, fold: ['b.pages', 'a.name'] }, joined);
    expect(both.folds).toEqual([
      { at: 2, count: 1 },
      { at: 3, count: 1 },
    ]);
  });

  it('ghostRows сжимает больше 200 строк до 20', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...BOOKS[0], key: `k${i}` }));
    const { rows, hiddenRows } = ghostRows(many);
    expect(rows).toHaveLength(COMPRESSED_VISIBLE_ROWS);
    expect(hiddenRows).toBe(230);
  });

  it('ровно 200 строк не сжимаются', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...BOOKS[0], key: `k${i}` }));
    expect(ghostRows(many).hiddenRows).toBe(0);
  });

  it('сжатый режим Ф5: строк нет, число берётся из rowCount', () => {
    const [scan, filter] = compressedTrace(5000).stages;
    expect(stageRows(scan)).toBe(5000);
    expect(stageRows(filter)).toBe(2500);
    expect(stageRows(bookScan())).toBe(5);
    const t = rebuildTable(base, scan.output, undefined, stageRows(scan));
    expect(t.rows).toEqual([]);
    expect(t.hiddenRows).toBe(5000);
    expect(totalRows(t)).toBe(5000);
  });

  it('withTable заменяет таблицу с тем же id и добавляет новую', () => {
    const t = rebuildTable(base, bookScan().output);
    const f1 = withTable({ tables: [], decorations: [] }, t);
    const f2 = withTable(f1, { ...t, x: 99 });
    expect(f2.tables).toHaveLength(1);
    expect(currentTable(f2)?.x).toBe(99);
  });

  it('clearMarks снимает состояния, бейджи и группы', () => {
    const t = mapRows(rebuildTable(base, bookScan().output), () => ({
      state: 'dropped',
      badge: '×2',
      group: 1,
    }));
    const c = clearMarks(t);
    expect(c.rows.every((r) => r.state === 'normal' && r.badge === undefined && r.group === undefined)).toBe(
      true,
    );
  });

  it('totalRows учитывает скрытые строки', () => {
    expect(totalRows({ ...rebuildTable(base, bookScan().output), hiddenRows: 10 })).toBe(15);
  });

  it('подписи стадий и названия таблиц', () => {
    expect(stageLabel(bookScan())).toBe('FROM');
    expect(tableTitle('public.book', 'b')).toBe('book b');
    expect(tableTitle('public.book', 'book')).toBe('book');
    expect(tableTitle('shop.orders', 'o')).toBe('shop.orders o');
  });
});
