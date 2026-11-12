import { rebuildTable, withTable } from '../frame';
import { ghostHeight, ghostWidth, rowTop, TABLE_GAP } from '../geometry';
import type { AnimatorContext, GhostTable, Phase, StageOf } from '../types';

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
  const affected = new Set([...stage.inserted, ...stage.deleted, ...stage.updated.map((row) => row.key)]);
  const visible = source.rows.filter((row) => affected.has(row.key));
  const focused = visible.length
    ? { ...source, rows: visible, hiddenRows: (source.hiddenRows ?? 0) + source.rows.length - visible.length }
    : source;
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
