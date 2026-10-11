import type { SelectCtx } from './context';
import { filterStep } from './filter';
import { projectStep } from './project';
import { scanStep } from './scan';

// Шаг SELECT в логическом порядке. Ф7 вставит join, group, having, Ф10 окна, ядро не меняется
export interface SelectStep {
  name: string;
  applies(ctx: SelectCtx): boolean;
  run(ctx: SelectCtx): Promise<void>;
}

export const SELECT_PIPELINE: SelectStep[] = [scanStep, filterStep, projectStep];

export async function runSelect(ctx: SelectCtx): Promise<void> {
  for (const step of SELECT_PIPELINE) if (step.applies(ctx)) await step.run(ctx);
}
