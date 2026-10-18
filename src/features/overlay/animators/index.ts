import type { Stage } from '@/features/tracer/types';
import type { Animator } from '../types';
import { distinctAnimator } from './distinct';
import { errorAnimator } from './error';
import { filterAnimator } from './filter';
import { groupAnimator } from './group';
import { joinAnimator } from './join';
import { limitAnimator } from './limit';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';
import { sortAnimator } from './sort';

// Реестр аниматоров по виду стадии. Виды без аниматора идут через genericAnimator
export const ANIMATORS: { [K in Stage['kind']]?: Animator<Extract<Stage, { kind: K }>> } = {
  scan: scanAnimator,
  join: joinAnimator,
  filter: filterAnimator,
  group: groupAnimator,
  project: projectAnimator,
  distinct: distinctAnimator,
  sort: sortAnimator,
  limit: limitAnimator,
  error: errorAnimator,
};
