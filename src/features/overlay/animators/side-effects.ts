import { rebuildTable, withTable } from '../frame';
import { ghostHeight, ghostWidth, rowTop, TABLE_GAP } from '../geometry';
import type { AnimatorContext, GhostTable, Phase, StageOf } from '../types';

function focusChanged(source: GhostTable, stage: StageOf<'dml'>): GhostTable {
  const affected = new Set([...stage.inserted, ...stage.deleted, ...stage.updated.map((row) => row.key)]);
  const visible = source.rows.filter((row) => affected.has(row.key));
  return visible.length
    ? { ...source, rows: visible, hiddenRows: (source.hiddenRows ?? 0) + source.rows.length - visible.length }
    : source;
}

// Снимки показывают фактические новые строки; возможные триггеры не означают доказанную причину.
export function sideEffectPhases(
  previous: Phase,
  stage: StageOf<'dml'>,
  stageIndex: number,
  ctx: AnimatorContext,
  source: GhostTable,
): Phase[] {
  const effects = stage.triggerEffects ?? [];
  if (!effects.length) return [];
  const focused = focusChanged(source, stage);
  let frame = withTable(previous.frame, focused);
  let y = Math.max(...frame.tables.map((table) => table.y + ghostHeight(table))) + TABLE_GAP;
  return effects.map((effect, index) => {
    const name = effect.tableId.split('.').at(-1) ?? effect.tableId;
    const table = rebuildTable(
      {
        id: `t:${effect.tableId}`,
        title: `Добавлено: ${name}`,
        x: focused.x,
        y,
        fold: ctx.folded(effect.tableId),
      },
      effect.added,
    );
    const ghost: GhostTable = {
      ...table,
      rows: table.rows.map((row) => ({
        ...row,
        state: 'new' as const,
        badge: 'побочный эффект',
        origin: { x: focused.x + ghostWidth(focused) / 2 - table.x, y: focused.y + rowTop(0) - table.y },
      })),
    };
    frame = withTable(
      {
        ...frame,
        decorations: [
          ...frame.decorations,
          {
            kind: 'arrow',
            id: `trigger:${stageIndex}:${index}`,
            from: { x: focused.x + ghostWidth(focused) / 2, y: focused.y + ghostHeight(focused) },
            to: { x: ghost.x + ghostWidth(ghost) / 2, y: ghost.y },
            tone: 'info',
          },
        ],
      },
      ghost,
    );
    y += ghostHeight(ghost) + TABLE_GAP;
    const candidates = effect.candidates.join(', ');
    return {
      id: `${stageIndex}:trigger:${index}`,
      stageIndex,
      caption: `Побочные изменения: +${effect.added.rows.length} в ${name}; возможный триггер ${candidates}`,
      durationMs: 650,
      frame,
    };
  });
}

// В секциях показываем только строки, действительно возвращённые INSERT с tableoid.
export function routingPhases(
  previous: Phase,
  stage: StageOf<'dml'>,
  stageIndex: number,
  ctx: AnimatorContext,
  source: GhostTable,
): Phase[] {
  const groups = stage.routing ?? [];
  if (!groups.length) return [];
  const focused = focusChanged(source, stage);
  let frame = withTable(previous.frame, focused);
  let y = Math.max(...frame.tables.map((table) => table.y + ghostHeight(table))) + TABLE_GAP;
  const templates = groups.map((group) => {
    const name = group.partitionId.split('.').at(-1) ?? group.partitionId;
    return rebuildTable(
      { id: `t:${group.partitionId}`, title: name, x: 0, y: 0, fold: ctx.folded(group.partitionId) },
      group.added,
    );
  });
  const columnWidth = Math.max(...templates.map(ghostWidth)) + TABLE_GAP;
  let rowHeight = 0;
  templates.forEach((template, index) => {
    const x = focused.x + (index % 2) * columnWidth;
    const table: GhostTable = {
      ...template,
      x,
      y,
      rows: template.rows.map((row) => ({
        ...row,
        state: 'new' as const,
        badge: 'секция',
        origin: { x: focused.x + ghostWidth(focused) / 2 - x, y: focused.y + rowTop(0) - y },
      })),
    };
    frame = withTable(
      {
        ...frame,
        decorations: [
          ...frame.decorations,
          {
            kind: 'arrow',
            id: `routing:${stageIndex}:${index}`,
            from: { x: focused.x + ghostWidth(focused) / 2, y: focused.y + ghostHeight(focused) },
            to: { x: table.x + ghostWidth(table) / 2, y: table.y },
            tone: 'info',
          },
        ],
      },
      table,
    );
    rowHeight = Math.max(rowHeight, ghostHeight(table));
    if (index % 2 === 1) {
      y += rowHeight + TABLE_GAP;
      rowHeight = 0;
    }
  });
  const count = groups.reduce((sum, group) => sum + group.added.rows.length, 0);
  return [
    {
      id: `${stageIndex}:routing`,
      stageIndex,
      caption: `Маршрутизация: строк: ${count}, секций: ${groups.length}${stage.partitionKey ? `; ${stage.partitionKey}` : ''}`,
      durationMs: 650,
      frame,
    },
  ];
}
