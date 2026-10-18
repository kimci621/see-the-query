import type { Stage } from '@/features/tracer/types';
import { currentTable, rebuildTable, stageRows, withTable } from '../frame';
import type { Animator } from '../types';

// Стадия без своей анимации: таблица мгновенно принимает вид выхода стадии
export const genericAnimator: Animator<Stage> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  const base = cur ?? { id: `stage:${stageIndex}`, title: 'результат', x: ctx.workArea.x, y: ctx.workArea.y };
  const table = rebuildTable(base, stage.output, undefined, stageRows(stage));
  return [
    {
      id: `${stageIndex}:result`,
      stageIndex,
      caption: stage.caption,
      durationMs: 500,
      frame: withTable({ ...prev, decorations: [] }, table),
    },
  ];
};
