import { rebuildTable, withTable } from '../frame';
import type { Animator, StageOf } from '../types';

export const materializeAnimator: Animator<StageOf<'materialize'>> = (prev, stage, stageIndex, ctx) => {
  const table = {
    ...rebuildTable(
      { id: `m:${stageIndex}`, title: stage.name, x: ctx.workArea.x, y: ctx.workArea.y },
      stage.output,
    ),
    dashed: true,
  };
  return [
    {
      id: `${stageIndex}:materialize`,
      stageIndex,
      caption: stage.caption,
      durationMs: 500,
      frame: withTable({ ...prev, decorations: [] }, table),
    },
  ];
};
