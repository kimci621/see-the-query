import { explainError } from '@/features/errors/explain';
import type { Animator, GhostTable, StageOf } from '../types';

// 42803 «column … must appear»: призрак таблицы у её ноды на доске, колонка вне GROUP BY перечёркнута.
// У остальных ошибок (и у 42803 без найденной колонки) сцены нет: всё объясняет панель «Сообщения»
export const errorAnimator: Animator<StageOf<'error'>> = (prev, stage, stageIndex, ctx) => {
  const table = ctx.schema.tables.find((t) => t.id === stage.focus.tableIds[0]);
  const column = stage.error.message.match(/column "(?:[^"]*\.)?([^".]+)" must appear/)?.[1];
  if (stage.error.code !== '42803' || !table || stage.focus.columns.join() !== `${table.id}.${column}`)
    return [];
  const rect = ctx.nodeRect(table.id);
  const focus = new Set(stage.focus.columns);
  const ghost: GhostTable = {
    id: `t:${table.name}`,
    title: table.name,
    x: rect?.x ?? ctx.workArea.x,
    y: rect?.y ?? ctx.workArea.y,
    columns: table.columns.map((c) => ({
      name: c.name,
      type: c.type,
      state: focus.has(`${table.id}.${c.name}`) ? 'removed' : 'normal',
    })),
    rows: [],
  };
  const { title } = explainError(stage.error, { sql: '', schema: ctx.schema });
  return [
    {
      id: `${stageIndex}:error`,
      stageIndex,
      caption: `${title}. ${stage.caption}`,
      durationMs: 600,
      frame: { tables: [...prev.tables, ghost], decorations: [] },
    },
  ];
};
