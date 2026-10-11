import type { Trace } from '@/features/tracer/types';
import { ANIMATORS } from '../animators';
import { genericAnimator } from '../animators/generic';
import type { Animator, AnimatorContext, Frame } from '../types';

// Прогоняет стадии [0, upTo) и возвращает последний кадр
export function runUpTo(trace: Trace, upTo: number, ctx: AnimatorContext): Frame {
  let frame: Frame = { tables: [], decorations: [] };
  trace.stages.slice(0, upTo).forEach((stage, i) => {
    const animator = (ANIMATORS[stage.kind] ?? genericAnimator) as Animator;
    const phases = animator(frame, stage, i, ctx);
    if (phases.length) frame = phases[phases.length - 1].frame;
  });
  return frame;
}
