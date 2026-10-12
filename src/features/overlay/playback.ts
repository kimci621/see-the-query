import type { Trace } from '@/features/tracer/types';
import { ANIMATORS } from './animators';
import { genericAnimator } from './animators/generic';
import type { Animator, AnimatorContext, Frame, Phase, Playback } from './types';

export type { Playback };
export { ANIMATORS };

// Прогоняет стадии трассы через аниматоры и собирает плоский список фаз.
// У трассы с ошибкой единственная стадия error: её сцену решает errorAnimator
export function buildPlayback(trace: Trace, ctx: AnimatorContext): Playback {
  if ((trace.mode !== 'full' && !trace.error) || trace.stages.length === 0)
    return { phases: [], stageStarts: [] };
  let frame: Frame = { tables: [], decorations: [] };
  const phases: Phase[] = [];
  const stageStarts: number[] = [];
  trace.stages.forEach((stage, i) => {
    const animator = (ANIMATORS[stage.kind] ?? genericAnimator) as Animator;
    const out = animator(frame, stage, i, ctx);
    stageStarts.push(phases.length);
    phases.push(...out);
    if (out.length) frame = out[out.length - 1].frame;
  });
  return { phases, stageStarts };
}

// Индекс последней фазы стадии: туда прыгает клик по чипу
export function lastPhaseOfStage(p: Playback, stageIndex: number): number {
  const next = p.stageStarts[stageIndex + 1];
  return (next ?? p.phases.length) - 1;
}

export function stageOfPhase(p: Playback, phaseIndex: number): number {
  return p.phases[phaseIndex]?.stageIndex ?? 0;
}
