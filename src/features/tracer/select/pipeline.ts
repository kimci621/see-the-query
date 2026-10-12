import type { SelectCtx } from './context';
import { distinctStep } from './distinct';
import { filterStep } from './filter';
import { groupStep } from './group';
import { joinStep } from './join';
import { limitStep } from './limit';
import { projectStep } from './project';
import { scanStep } from './scan';
import { sortStep } from './sort';

// Шаг SELECT в логическом порядке. Ф7 вставит join, group, having, Ф10 окна, ядро не меняется
export interface SelectStep {
  name: string;
  applies(ctx: SelectCtx): boolean;
  run(ctx: SelectCtx): Promise<void>;
}

export const SELECT_PIPELINE: SelectStep[] = [
  scanStep,
  joinStep,
  filterStep,
  groupStep,
  projectStep,
  distinctStep,
  sortStep,
  limitStep,
];

export async function runSelect(ctx: SelectCtx): Promise<void> {
  for (const step of SELECT_PIPELINE) if (step.applies(ctx)) await step.run(ctx);
}
