import type { Stage } from '@/features/tracer/types';
import type { Animator } from '../types';
import { ddlAnimator } from './ddl';
import { distinctAnimator } from './distinct';
import { dmlAnimator } from './dml';
import { errorAnimator } from './error';
import { filterAnimator } from './filter';
import { groupAnimator } from './group';
import { joinAnimator } from './join';
import { limitAnimator } from './limit';
import { materializeAnimator } from './materialize';
import { projectAnimator } from './project';
import { recursionAnimator } from './recursion';
import { scanAnimator } from './scan';
import { setopAnimator } from './setop';
import { sortAnimator } from './sort';
import { subqueryAnimator } from './subquery';
import { windowAnimator } from './window';

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
  dml: dmlAnimator,
  ddl: ddlAnimator,
  materialize: materializeAnimator,
  setop: setopAnimator,
  recursion: recursionAnimator,
  window: windowAnimator,
  subquery: subqueryAnimator,
  error: errorAnimator,
};
