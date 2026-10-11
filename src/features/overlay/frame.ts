import type { Relation, Row, RowKey, Stage } from '@/features/tracer/types';
import { COMPRESS_THRESHOLD, COMPRESSED_VISIBLE_ROWS, ghostWidth } from './geometry';
import type { Decoration, Frame, GhostColumn, GhostRow, GhostTable, RowState } from './types';

// Рабочая таблица сцены: последняя добавленная
export function currentTable(frame: Frame): GhostTable | null {
  return frame.tables.length ? frame.tables[frame.tables.length - 1] : null;
}

export function withTable(frame: Frame, table: GhostTable): Frame {
  const idx = frame.tables.findIndex((t) => t.id === table.id);
  const tables = idx === -1 ? [...frame.tables, table] : frame.tables.map((t, i) => (i === idx ? table : t));
  return { ...frame, tables };
}

// Сжатый режим: больше 200 строк рисуем первые 20, остальное считаем
export function ghostRows(rows: Row[], state: RowState = 'normal'): { rows: GhostRow[]; hiddenRows: number } {
  const visible = rows.length > COMPRESS_THRESHOLD ? rows.slice(0, COMPRESSED_VISIBLE_ROWS) : rows;
  return {
    rows: visible.map((r) => ({ key: r.key, values: r.values, state })),
    hiddenRows: rows.length - visible.length,
  };
}

// Число строк стадии: в сжатом режиме Ф5 строк нет, есть точный rowCount
export function stageRows(stage: Stage): number {
  return stage.rowCount ?? stage.output.rows.length;
}

// Пересборка таблицы из выхода стадии: это гарантирует, что кадр совпадает с данными Postgres.
// total: настоящее число строк, если их больше, чем пришло (сжатый режим Ф5)
export function rebuildTable(
  base: Pick<GhostTable, 'id' | 'title' | 'x' | 'y'>,
  rel: Relation,
  order?: RowKey[],
  total = rel.rows.length,
): GhostTable {
  let rows = rel.rows;
  if (order) {
    const pos = new Map(order.map((k, i) => [k, i]));
    rows = [...rows].sort(
      (a, b) => (pos.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const g = ghostRows(rows);
  return {
    id: base.id,
    title: base.title,
    x: base.x,
    y: base.y,
    columns: rel.columns.map((c) => ({ name: c.name, type: c.type, state: 'normal' as const })),
    rows: g.rows,
    hiddenRows: Math.max(g.hiddenRows, total - g.rows.length),
  };
}

export function mapRows(t: GhostTable, fn: (r: GhostRow, i: number) => Partial<GhostRow>): GhostTable {
  return { ...t, rows: t.rows.map((r, i) => ({ ...r, ...fn(r, i) })) };
}

export function mapColumns(
  t: GhostTable,
  fn: (c: GhostColumn, i: number) => Partial<GhostColumn>,
): GhostTable {
  return { ...t, columns: t.columns.map((c, i) => ({ ...c, ...fn(c, i) })) };
}

export function clearMarks(t: GhostTable): GhostTable {
  return {
    ...t,
    columns: t.columns.map((c) => ({ ...c, state: 'normal' as const })),
    rows: t.rows.map(({ key, values }) => ({ key, values, state: 'normal' as const })),
  };
}

export function totalRows(t: GhostTable): number {
  return t.rows.length + (t.hiddenRows ?? 0);
}

// Счётчик «было → стало» справа от таблицы
export function counterNear(t: GhostTable, id: string, text: string): Decoration {
  return { kind: 'counter', id, x: t.x + ghostWidth(t) + 16, y: t.y, text };
}
