import dagre from '@dagrejs/dagre';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { readRootFont } from '@/hooks/use-root-font';

// Длины доски и призраков в rem (спека 3.4, WCAG 1.4.4): растут вместе с настройкой шрифта браузера.
// React Flow, dagre и оверлей считают в px, поэтому rem переводится в px только здесь, от текущего
// корневого размера шрифта. setRootFont пересчитывает константы; импортёры видят новые значения,
// export let - живая привязка ES-модуля. Комментарии с px - значения при корне 16px
let rootFont = 16;
export const rem = (n: number) => n * rootFont;

export let TABLE_WIDTH: number; // 260px
export let ROW_HEIGHT: number; // 24px
export let HEADER_HEIGHT: number; // 36px
export let COLUMN_WIDTH: number; // 132px
// Заглушка «+N колонки» у свёрнутой таблицы
export let STUB_WIDTH: number; // 96px
export let COLUMN_HEADER_HEIGHT: number; // 40px
export let SCHEMA_GAP: number; // 120px
// Рамка схемы: отступ вокруг таблиц и строка подписи
export let GROUP_PADDING: number; // 24px
export let GROUP_LABEL: number; // 28px
// Зазор между призраками сцены и от таблиц доски до рабочей зоны сцены
export let TABLE_GAP: number; // 80px
export let WORK_AREA_GAP: number; // 160px

export function setRootFont(px: number): void {
  rootFont = px;
  TABLE_WIDTH = rem(16.25);
  ROW_HEIGHT = rem(1.5);
  HEADER_HEIGHT = rem(2.25);
  COLUMN_WIDTH = rem(8.25);
  STUB_WIDTH = rem(6);
  COLUMN_HEADER_HEIGHT = rem(2.5);
  SCHEMA_GAP = rem(7.5);
  GROUP_PADDING = rem(1.5);
  GROUP_LABEL = rem(1.75);
  TABLE_GAP = rem(5);
  WORK_AREA_GAP = rem(10);
}

setRootFont(readRootFont());

export const MAX_VISIBLE_ROWS = 15;
// Таблица шире этого числа колонок свёрнута, видно не меньше FOLD_MIN колонок
const FOLD_FROM = 6;
const FOLD_MIN = 5;
// Ниже этого зума доска показывает только шапки и имена колонок (семантический зум, CSS в board.css)
export const FAR_ZOOM = 0.5;
// Нижняя граница зума автоподгонки: мельче текст не читается
export const FIT_MIN_ZOOM = 0.6;

// Снизу у доски полоса хрома: кнопки зума и плашка версии Postgres (BoardStatus). Кадры держат её
// пустой, чтобы хром не ложился на таблицы. Считаем в rem: плашка растёт вместе с текстом
export const chromeBottom = () => `${Math.round(rem(3.5))}px` as const;

// Якорь кадра (спека 3.4): если на зуме кадра таблицы не влезают в доску по оси, по этой оси
// кадр держит левый (верхний) край у отступа, а не центр: шапка и PK видны. Отступы кадра
// декоративные, их fitView ужимает сам; снизу полоса хрома, её занимать нельзя. Всё в px экрана
export function anchorFrame(
  vp: { x: number; y: number; zoom: number },
  b: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  pad: { left: number; top: number; bottom: number },
) {
  const z = vp.zoom;
  // 1 px допуска: отступы React Flow округляет вниз
  return {
    x: b.width * z > width + 1 ? pad.left - b.x * z : vp.x,
    y: b.height * z > height - pad.bottom + 1 ? pad.top - b.y * z : vp.y,
    zoom: z,
  };
}

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
    g.setGraph({ rankdir: 'LR', nodesep: rem(3.75), ranksep: rem(7.5) });
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
