import dagre from '@dagrejs/dagre';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';

export const TABLE_WIDTH = 260;
export const ROW_HEIGHT = 24;
export const HEADER_HEIGHT = 36;
export const MAX_VISIBLE_ROWS = 15;
export const COLUMN_WIDTH = 132;
// Заглушка «+N колонки» у свёрнутой таблицы
export const STUB_WIDTH = 96;
// Таблица шире этого числа колонок свёрнута, видно не меньше FOLD_MIN колонок
const FOLD_FROM = 6;
const FOLD_MIN = 5;
export const COLUMN_HEADER_HEIGHT = 40;
export const SCHEMA_GAP = 120;
// Ниже этого зума доска показывает только шапки и имена колонок (семантический зум, CSS в board.css)
export const FAR_ZOOM = 0.5;
// Нижняя граница зума автоподгонки: мельче текст не читается
export const FIT_MIN_ZOOM = 0.6;

// Снизу у доски полоса хрома: кнопки зума и плашка версии Postgres (BoardStatus). Кадры держат её
// пустой, чтобы хром не ложился на таблицы. Считаем в rem: плашка растёт вместе с текстом
export const chromeBottom = () => {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return `${Math.round(3.5 * rem)}px` as const;
};

export type Positions = Record<string, { x: number; y: number }>;

// Полная ширина: по ней раскладка резервирует место, чтобы разворот не задевал соседей
export function tableWidth(t: TableInfo): number {
  return Math.max(TABLE_WIDTH, t.columns.length * COLUMN_WIDTH);
}

export interface Fold {
  visible: ColumnInfo[];
  hidden: ColumnInfo[];
}

// Свёртка широкой таблицы (спека 3.4): видны PK, FK и затронутые запросом колонки,
// добор по порядку схемы до FOLD_MIN. Порядок видимых всегда как в схеме.
export function foldColumns(t: TableInfo, touched: string[], expanded: boolean): Fold {
  if (expanded || t.columns.length <= FOLD_FROM) return { visible: t.columns, hidden: [] };
  const keep = new Set(
    t.columns.filter((c) => c.isPk || c.fk || touched.includes(c.name)).map((c) => c.name),
  );
  for (const c of t.columns) {
    if (keep.size >= FOLD_MIN) break;
    keep.add(c.name);
  }
  return {
    visible: t.columns.filter((c) => keep.has(c.name)),
    hidden: t.columns.filter((c) => !keep.has(c.name)),
  };
}

// Имена колонок этой таблицы из списка 'public.book.title'
export function ownColumns(all: string[], tableId: string): string[] {
  const prefix = `${tableId}.`;
  return all.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
}

export function foldWidth(f: Fold): number {
  return Math.max(TABLE_WIDTH, f.visible.length * COLUMN_WIDTH + (f.hidden.length > 0 ? STUB_WIDTH : 0));
}

// Шапка + заголовки колонок + видимые строки + строка «+ ещё N» или «пусто»
export function tableHeight(t: TableInfo): number {
  const visible = Math.min(t.sampleRows.length, MAX_VISIBLE_ROWS);
  const footer = t.rowCount > visible || t.rowCount === 0 ? ROW_HEIGHT : 0;
  return HEADER_HEIGHT + COLUMN_HEADER_HEIGHT + visible * ROW_HEIGHT + footer;
}

export function isTableVisible(visible: string[] | null, id: string): boolean {
  return visible === null || visible.includes(id);
}

// Порядок схем: как в снимке, плюс схемы таблиц, которых там нет
export function schemaNames(schema: SchemaSnapshot): string[] {
  return [...new Set([...schema.schemas, ...schema.tables.map((t) => t.schema)])];
}

// dagre слева направо отдельно по каждой схеме; схемы стоят рядом с зазором SCHEMA_GAP.
// Межсхемные FK в раскладке не участвуют, чтобы рамки схем не пересекались.
export function autoLayout(schema: SchemaSnapshot, visible: string[] | null): Positions {
  const result: Positions = {};
  let offsetX = 0;
  for (const name of schemaNames(schema)) {
    const tables = schema.tables.filter((t) => t.schema === name && isTableVisible(visible, t.id));
    if (tables.length === 0) continue;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const t of tables) g.setNode(t.id, { width: tableWidth(t), height: tableHeight(t) });
    for (const fk of schema.fks) {
      const { tableId: from } = fk.from;
      const { tableId: to } = fk.to;
      // ребро от таблицы, на которую ссылаются, поэтому она оказывается левее
      if (from !== to && g.hasNode(from) && g.hasNode(to)) g.setEdge(to, from);
    }
    dagre.layout(g);

    const local = tables.map((t) => {
      const n = g.node(t.id);
      return { id: t.id, x: n.x - n.width / 2, y: n.y - n.height / 2, right: n.x + n.width / 2 };
    });
    const minX = Math.min(...local.map((p) => p.x));
    const minY = Math.min(...local.map((p) => p.y));
    const maxX = Math.max(...local.map((p) => p.right));
    for (const p of local) result[p.id] = { x: offsetX + p.x - minX, y: p.y - minY };
    offsetX += maxX - minX + SCHEMA_GAP;
  }
  return result;
}
