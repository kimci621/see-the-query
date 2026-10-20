import {
  COLUMN_HEADER_HEIGHT,
  COLUMN_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  STUB_WIDTH,
  TABLE_WIDTH,
} from '@/features/board/layout';
import type { Frame, GhostTable } from './types';

// Размеры призрака совпадают с нодой доски: призрак scan стартует ровно поверх неё
export const COL_WIDTH = COLUMN_WIDTH;
export const TITLE_HEIGHT = HEADER_HEIGHT;
export const COLHEAD_HEIGHT = COLUMN_HEADER_HEIGHT;
export const ROW_H = ROW_HEIGHT;
export const TABLE_GAP = 80;
export const COMPRESS_THRESHOLD = 200;
export const COMPRESSED_VISIBLE_ROWS = 20;

// Как foldWidth у ноды: колонки и заглушка «+N колонки», если часть колонок свёрнута
export function ghostWidth(t: GhostTable): number {
  return Math.max(TABLE_WIDTH, t.columns.length * COL_WIDTH + (t.foldedColumns ? STUB_WIDTH : 0));
}

export function ghostHeight(t: GhostTable): number {
  const band = t.hiddenRows ? 1 : 0;
  return TITLE_HEIGHT + COLHEAD_HEIGHT + (t.rows.length + band) * ROW_H;
}

// Верх строки относительно верха таблицы
export function rowTop(index: number): number {
  return TITLE_HEIGHT + COLHEAD_HEIGHT + index * ROW_H;
}

export function cellLeft(colIndex: number): number {
  return colIndex * COL_WIDTH;
}

export function frameBounds(frame: Frame): { x: number; y: number; width: number; height: number } | null {
  if (frame.camera) return frame.camera;
  if (frame.tables.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of frame.tables) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + ghostWidth(t));
    maxY = Math.max(maxY, t.y + ghostHeight(t));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Центр ячейки в координатах доски (для линий пар и стрелок)
export function cellCenter(t: GhostTable, rowKey: string, colName: string): { x: number; y: number } | null {
  const rowIndex = t.rows.findIndex((r) => r.key === rowKey);
  const colIndex = t.columns.findIndex((c) => c.name === colName);
  if (rowIndex === -1 || colIndex === -1) return null;
  return { x: t.x + cellLeft(colIndex) + COL_WIDTH / 2, y: t.y + rowTop(rowIndex) + ROW_H / 2 };
}

// Стабильные ключи колонок: одноимённые получают суффикс #2, #3
export function columnKeys(cols: { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return cols.map((c) => {
    const n = (seen.get(c.name) ?? 0) + 1;
    seen.set(c.name, n);
    return n === 1 ? c.name : `${c.name}#${n}`;
  });
}
