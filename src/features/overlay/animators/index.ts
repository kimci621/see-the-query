import type { Stage } from '@/features/tracer/types';
import type { Animator } from '../types';
import { distinctAnimator } from './distinct';
import { filterAnimator } from './filter';
import { limitAnimator } from './limit';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';
import { sortAnimator } from './sort';

// Реестр аниматоров по виду стадии. Виды без аниматора идут через genericAnimator
export const ANIMATORS: { [K in Stage['kind']]?: Animator<Extract<Stage, { kind: K }>> } = {
  scan: scanAnimator,
  filter: filterAnimator,
  project: projectAnimator,
  distinct: distinctAnimator,
  sort: sortAnimator,
  limit: limitAnimator,
};
