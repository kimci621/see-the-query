import type { Edge, Node } from '@xyflow/react';
import type { FkInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { rowsWord } from '@/lib/plural';
import {
  autoLayout,
  foldColumns,
  foldWidth,
  isTableVisible,
  type Positions,
  SCHEMA_GAP,
  schemaNames,
  tableHeight,
  tableWidth,
} from './layout';

// Фокус и подсветку нода читает из useBoardStore, поэтому в data только таблица
export interface TableNodeData extends Record<string, unknown> {
  table: TableInfo;
}
export interface SchemaGroupData extends Record<string, unknown> {
  schema: string;
}
export interface FkEdgeData extends Record<string, unknown> {
  fk: FkInfo;
}
export type TableFlowNode = Node<TableNodeData, 'table'>;
export type SchemaFlowNode = Node<SchemaGroupData, 'schemaGroup'>;
export type BoardNode = TableFlowNode | SchemaFlowNode;
export type FkFlowEdge = Edge<FkEdgeData, 'fk'>;

export const GROUP_PADDING = 24;
export const GROUP_LABEL = 28;

// Подпись ноды для скринридера: таблица, строк всего (не только показанных), все колонки
export function tableAriaLabel(t: TableInfo): string {
  return `Таблица ${t.schema}.${t.name}, ${rowsWord(t.rowCount)}, колонки: ${t.columns.map((c) => c.name).join(', ')}`;
}

export function normalizeTableId(name: string): string {
  return name.includes('.') ? name : `public.${name}`;
}

// Автораскладка, поверх неё координаты из frontmatter урока (имена без схемы считаются public)
export function resolvePositions(
  schema: SchemaSnapshot,
  visible: string[] | null,
  layout?: 'auto' | Record<string, { x: number; y: number }>,
): Positions {
  if (!layout || layout === 'auto') return autoLayout(schema, visible);
  const manual: Positions = Object.fromEntries(
    Object.entries(layout).map(([name, p]) => [normalizeTableId(name), p]),
  );
  // Таблицы без координат урока (например, созданные учеником) встают правее таблиц урока, а не поверх них
  const rest = schema.tables.filter((t) => isTableVisible(visible, t.id) && !manual[t.id]).map((t) => t.id);
  const right = Math.max(
    0,
    ...schema.tables.filter((t) => manual[t.id]).map((t) => manual[t.id].x + tableWidth(t)),
  );
  const auto = Object.entries(autoLayout(schema, rest)).map(([id, p]) => [
    id,
    { x: p.x + right + SCHEMA_GAP, y: p.y },
  ]);
  return { ...Object.fromEntries(auto), ...manual };
}

export function buildNodes(
  schema: SchemaSnapshot,
  visible: string[] | null,
  positions: Positions,
): BoardNode[] {
  const groups: SchemaFlowNode[] = [];
  const tables: TableFlowNode[] = [];
  for (const name of schemaNames(schema)) {
    const members = schema.tables.filter(
      (t) => t.schema === name && isTableVisible(visible, t.id) && positions[t.id],
    );
    if (members.length === 0) continue;

    const boxes = members.map((t) => {
      const p = positions[t.id] ?? { x: 0, y: 0 };
      return { t, x: p.x, y: p.y, w: tableWidth(t), h: tableHeight(t) };
    });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const gx = minX - GROUP_PADDING;
    const gy = minY - GROUP_PADDING - GROUP_LABEL;
    const groupId = `schema:${name}`;

    groups.push({
      id: groupId,
      type: 'schemaGroup',
      position: { x: gx, y: gy },
      data: { schema: name },
      width: maxX - minX + 2 * GROUP_PADDING,
      height: maxY - minY + 2 * GROUP_PADDING + GROUP_LABEL,
      selectable: false,
      focusable: false,
    });
    for (const b of boxes) {
      tables.push({
        id: b.t.id,
        type: 'table',
        parentId: groupId,
        position: { x: b.x - gx, y: b.y - gy },
        data: { table: b.t },
        // Фокус при Tab попадает на обёртку ноды React Flow, подпись нужна ей
        ariaLabel: tableAriaLabel(b.t),
        // По умолчанию React Flow называет роль «node»
        domAttributes: { 'aria-roledescription': 'таблица' },
        // Ширину задаёт сама нода (свёртка зависит от запроса), React Flow её замеряет.
        // initialWidth (свёрнутая ширина без запроса) нужна только до замера: для отсечения
        // невидимых нод при onlyRenderVisibleElements.
        // Позиции и рамка схемы считаются по полной ширине, разворот соседей не задевает.
        initialWidth: foldWidth(foldColumns(b.t, [], false)),
        height: b.h,
        // Без выбора и переноса React Flow ставит ноде pointer-events: none, и title у колонок,
        // флагов и «+N колонки» не показываются. Pan по ноде работает: класса nopan у неё нет
        style: { pointerEvents: 'all' },
      });
    }
  }
  // React Flow требует, чтобы родитель шёл раньше детей
  return [...groups, ...tables];
}

export function buildEdges(schema: SchemaSnapshot, visible: string[] | null): FkFlowEdge[] {
  const known = new Set(schema.tables.map((t) => t.id));
  return schema.fks
    .filter((fk) => known.has(fk.from.tableId) && known.has(fk.to.tableId))
    .filter((fk) => isTableVisible(visible, fk.from.tableId) && isTableVisible(visible, fk.to.tableId))
    .map((fk) => ({
      id: `${fk.name}:${fk.from.tableId}`,
      type: 'fk',
      source: fk.to.tableId,
      target: fk.from.tableId,
      data: { fk },
      selectable: false,
      focusable: false,
    }));
}
