import { describe, expect, it } from 'vitest';
import { STUB_WIDTH, TABLE_WIDTH } from '@/features/board/layout';
import { counterNear } from './frame';
import {
  COL_WIDTH,
  COLHEAD_HEIGHT,
  cellLeft,
  columnKeys,
  columnWidth,
  frameBounds,
  ghostHeight,
  ghostWidth,
  marksWidth,
  ROW_H,
  rowAnchor,
  rowTop,
  stubLefts,
  TITLE_HEIGHT,
} from './geometry';
import type { GhostTable } from './types';

const table = (over: Partial<GhostTable> = {}): GhostTable => ({
  id: 't:b',
  title: 'book',
  x: 100,
  y: 50,
  columns: [
    { name: 'title', state: 'normal' },
    { name: 'price', state: 'normal' },
  ],
  rows: [
    { key: 'b=(0,1)', values: ['Тихий Дон', '890.00'], state: 'normal' },
    { key: 'b=(0,2)', values: ['Python', '2400.00'], state: 'normal' },
  ],
  ...over,
});

describe('geometry', () => {
  it('размеры как у ноды доски: ширина по колонкам, но не меньше TABLE_WIDTH', () => {
    expect(ghostWidth(table())).toBe(Math.max(TABLE_WIDTH, 2 * COL_WIDTH));
    expect(
      ghostWidth(
        table({
          columns: Array.from({ length: 3 }, (_, i) => ({ name: `c${i}`, state: 'normal' as const })),
        }),
      ),
    ).toBe(3 * COL_WIDTH);
    expect(ghostHeight(table())).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 2 * ROW_H);
  });

  it('полоса скрытых строк добавляет одну строку высоты', () => {
    expect(ghostHeight(table({ hiddenRows: 300 }))).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 3 * ROW_H);
  });

  it('пустая таблица имеет минимальную ширину ноды', () => {
    expect(ghostWidth(table({ columns: [] }))).toBe(TABLE_WIDTH);
  });

  it('rowTop считает от верха таблицы', () => {
    expect(rowTop(0)).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT);
    expect(rowTop(3)).toBe(TITLE_HEIGHT + COLHEAD_HEIGHT + 3 * ROW_H);
  });

  it('frameBounds объединяет все таблицы', () => {
    const a = table();
    const b = table({ id: 't:a', x: 600, y: 0 });
    expect(frameBounds({ tables: [a, b], decorations: [] })).toEqual({
      x: 100,
      y: 0,
      width: 600 + ghostWidth(b) - 100,
      height: 50 + ghostHeight(a),
    });
    expect(frameBounds({ tables: [], decorations: [] })).toBeNull();
  });

  it('frameBounds вмещает счётчик справа от таблицы: камера не обрезает «4 → 2»', () => {
    const t = table();
    const b = frameBounds({ tables: [t], decorations: [counterNear(t, 'c', '4 → 2')] });
    expect(b?.x).toBe(100);
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBeGreaterThan(100 + ghostWidth(t) + 16 + 5 * 7);
  });

  it('frameBounds берёт camera, если она задана', () => {
    const camera = { x: 1, y: 2, width: 3, height: 4 };
    expect(frameBounds({ tables: [table()], decorations: [], camera })).toEqual(camera);
  });

  it('rowAnchor: край таблицы на середине строки', () => {
    expect(rowAnchor(table(), 'b=(0,2)', 'right')).toEqual({
      x: 100 + ghostWidth(table()),
      y: 50 + rowTop(1) + ROW_H / 2,
    });
    expect(rowAnchor(table(), 'b=(0,2)', 'left')?.x).toBe(100);
    expect(rowAnchor(table(), 'нет', 'left')).toBeNull();
  });

  it('columnKeys различает одноимённые колонки', () => {
    expect(columnKeys([{ name: 'a' }, { name: 'b' }, { name: 'a' }])).toEqual(['a', 'b', 'a#2']);
  });
});

describe('место под значки строк', () => {
  const wide = (rows: GhostTable['rows']) =>
    table({
      columns: Array.from({ length: 3 }, (_, i) => ({ name: `c${i}`, state: 'normal' as const })),
      rows,
    });
  it('значок и плашка строки получают полосу справа, последняя колонка не под ними', () => {
    const plain = wide([{ key: 'r', values: [1, 2, 3], state: 'normal' }]);
    expect(ghostWidth(plain)).toBe(3 * COL_WIDTH);
    const unknown = wide([{ key: 'r', values: [1, 2, null], state: 'unknown', badge: 'UNKNOWN' }]);
    expect(ghostWidth(unknown)).toBe(3 * COL_WIDTH + marksWidth(unknown));
    const kept = wide([{ key: 'r', values: [], state: 'kept' }]);
    expect(marksWidth(kept)).toBeGreaterThan(0);
    expect(marksWidth(unknown)).toBeGreaterThan(marksWidth(kept));
    expect(marksWidth(wide([{ key: 'r', values: [], state: 'normal', badge: '×2' }]))).toBeGreaterThan(20);
  });
  it('у свёрнутой таблицы значки встают в пустые ячейки заглушки', () => {
    const t = { ...wide([{ key: 'r', values: [], state: 'kept' as const }]), folds: [{ at: 3, count: 4 }] };
    expect(ghostWidth(t)).toBe(3 * COL_WIDTH + STUB_WIDTH);
  });
  it('заглушка в середине (JOIN): колонки правее неё сдвинуты, значки получают свою полосу', () => {
    const t = { ...wide([{ key: 'r', values: [], state: 'kept' as const }]), folds: [{ at: 1, count: 4 }] };
    expect(ghostWidth(t)).toBe(3 * COL_WIDTH + STUB_WIDTH + marksWidth(t));
    expect([0, 1, 2].map((ci) => cellLeft(t, ci))).toEqual([
      0,
      COL_WIDTH + STUB_WIDTH,
      2 * COL_WIDTH + STUB_WIDTH,
    ]);
    expect(stubLefts(t)).toEqual([COL_WIDTH]);
    expect(columnWidth(t, 2)).toBe(COL_WIDTH);
  });
});
