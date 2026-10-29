import type { Relation } from '@/features/tracer/types';
import { currentTable, mapColumns, mapRows, rebuildTable, withTable } from '../frame';
import type { Animator, Decoration, GhostTable, StageOf } from '../types';

function sampleRows(table: NonNullable<ReturnType<typeof tableOf>>): Relation {
  return {
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      source: { alias: table.name, column: column.name },
    })),
    rows: table.sampleRows.map((values, index) => ({
      key: `${table.name}=${table.sampleCtids[index]}`,
      lineage: { [table.name]: table.sampleCtids[index] },
      values,
    })),
  };
}

function tableOf(stage: StageOf<'error'>, ctx: Parameters<Animator>[3]) {
  return stage.focus.tableIds.map((id) => ctx.schema.tables.find((table) => table.id === id)).find(Boolean);
}

function markFocused(table: GhostTable, tableId: string, columns: string[]): GhostTable {
  const focused = new Set(
    columns
      .filter((column) => column.startsWith(`${tableId}.`))
      .map((column) => column.slice(tableId.length + 1)),
  );
  return mapColumns(table, (column) => ({ state: focused.has(column.name) ? 'error' : 'normal' }));
}

function dangerArrow(stage: StageOf<'error'>, ctx: Parameters<Animator>[3]): Decoration[] {
  const [fromId, toId] = stage.focus.tableIds;
  if (!fromId || !toId) return [];
  const from = ctx.nodeRect(fromId);
  const to = ctx.nodeRect(toId);
  if (!from || !to) return [];
  return [
    {
      kind: 'arrow',
      id: `constraint:${fromId}:${toId}`,
      from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      to: { x: to.x + to.width / 2, y: to.y + to.height / 2 },
      tone: 'danger',
    },
  ];
}

function conflictTable(
  prev: Parameters<Animator>[0],
  stage: StageOf<'error'>,
  table: NonNullable<ReturnType<typeof tableOf>>,
  ctx: Parameters<Animator>[3],
): GhostTable | null {
  const conflicts = new Set(stage.conflictKeys ?? []);
  const current = currentTable(prev);
  if (current?.rows.some((row) => conflicts.has(row.key))) {
    return markFocused(
      mapRows(current, (row) => (conflicts.has(row.key) ? { state: 'conflict' as const } : {})),
      table.id,
      stage.focus.columns,
    );
  }
  const rect = ctx.nodeRect(table.id);
  const rows = sampleRows(table).rows.filter((row) => conflicts.has(row.key));
  if (!rows.length) return null;
  return markFocused(
    mapRows(
      rebuildTable(
        {
          id: `t:${table.id}`,
          title: table.name,
          x: rect?.x ?? ctx.workArea.x,
          y: rect?.y ?? ctx.workArea.y,
          fold: ctx.folded(table.id),
        },
        { ...sampleRows(table), rows },
      ),
      () => ({ state: 'conflict' as const }),
    ),
    table.id,
    stage.focus.columns,
  );
}

export const constraintErrorAnimator: Animator<StageOf<'error'>> = (prev, stage, stageIndex, ctx) => {
  const table = tableOf(stage, ctx);
  if (!table) return [];
  const decorations = dangerArrow(stage, ctx);
  const conflict = stage.conflictKeys?.length ? conflictTable(prev, stage, table, ctx) : null;
  const base = conflict ? withTable({ ...prev, decorations }, conflict) : { ...prev, decorations };
  if (!stage.attempted) {
    if (!conflict) return [];
    return [
      {
        id: `${stageIndex}:constraint-error`,
        stageIndex,
        caption: stage.caption,
        durationMs: 650,
        frame: base,
      },
    ];
  }
  const rect = ctx.nodeRect(table.id);
  const attempted = markFocused(
    mapRows(
      rebuildTable(
        {
          id: `a:${table.id}`,
          title: 'попытка',
          x: ctx.workArea.x,
          y: ctx.workArea.y,
          fold: ctx.folded(table.id),
        },
        stage.attempted,
      ),
      () => ({ state: 'unknown' as const }),
    ),
    table.id,
    stage.focus.columns,
  );
  const hit = { ...attempted, x: rect?.x ?? attempted.x, y: rect?.y ?? attempted.y, opacity: 1 };
  return [
    {
      id: `${stageIndex}:constraint-attempt`,
      stageIndex,
      caption: `${stage.caption}: проверяем новую строку`,
      durationMs: 450,
      frame: withTable(base, attempted),
    },
    {
      id: `${stageIndex}:constraint-error`,
      stageIndex,
      caption: stage.caption,
      durationMs: 500,
      frame: withTable(base, hit),
    },
  ];
};
