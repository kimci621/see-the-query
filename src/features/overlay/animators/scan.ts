import { rebuildTable, stageRows } from '../frame';
import { ghostWidth, TABLE_GAP } from '../geometry';
import { tableTitle } from '../labels';
import type { Animator, Frame, StageOf } from '../types';

// FROM t: призрак отделяется от таблицы на доске и уезжает в рабочую зону
export const scanAnimator: Animator<StageOf<'scan'>> = (prev, stage, stageIndex, ctx) => {
  const id = `t:${stage.alias}`;
  const title = tableTitle(stage.tableId, stage.alias);
  const others = prev.tables.filter((t) => t.id !== id);
  // следующая таблица встаёт правее уже стоящих в рабочей зоне
  const targetX = others.reduce((x, t) => Math.max(x, t.x + ghostWidth(t) + TABLE_GAP), ctx.workArea.x);
  const rect = ctx.nodeRect(stage.tableId);
  const start = rebuildTable(
    { id, title, x: rect?.x ?? targetX, y: rect?.y ?? ctx.workArea.y },
    stage.output,
    undefined,
    stageRows(stage),
  );
  const moved = { ...start, x: targetX, y: ctx.workArea.y };
  const appear: Frame = { tables: [...others, start], decorations: [] };
  const placed: Frame = { tables: [...others, moved], decorations: [] };
  return [
    {
      id: `${stageIndex}:appear`,
      stageIndex,
      caption: `Берём таблицу ${title}`,
      durationMs: 500,
      frame: appear,
    },
    { id: `${stageIndex}:place`, stageIndex, caption: stage.caption, durationMs: 700, frame: placed },
  ];
};
