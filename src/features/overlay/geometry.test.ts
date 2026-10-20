import { describe, expect, it } from 'vitest';
import { TABLE_WIDTH } from '@/features/board/layout';
import { counterNear } from './frame';
import {
  COL_WIDTH,
  COLHEAD_HEIGHT,
  cellCenter,
  columnKeys,
  frameBounds,
  ghostHeight,
  ghostWidth,
  ROW_H,
  rowTop,
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

  it('cellCenter находит ячейку по ключу строки и имени колонки', () => {
    expect(cellCenter(table(), 'b=(0,2)', 'price')).toEqual({
      x: 100 + COL_WIDTH + COL_WIDTH / 2,
      y: 50 + rowTop(1) + ROW_H / 2,
    });
    expect(cellCenter(table(), 'нет', 'price')).toBeNull();
  });

  it('columnKeys различает одноимённые колонки', () => {
    expect(columnKeys([{ name: 'a' }, { name: 'b' }, { name: 'a' }])).toEqual(['a', 'b', 'a#2']);
  });
});
