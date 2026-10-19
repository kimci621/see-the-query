import { describe, expect, it } from 'vitest';
import type { Stage } from '@/features/tracer/types';
import { aggregateTrace, groupTrace } from './__fixtures__/traces';
import { stageLabel } from './labels';

type GroupStage = Extract<Stage, { kind: 'group' }>;
const aggregate = (aggregates: string[]): GroupStage => ({
  ...(aggregateTrace().stages[1] as GroupStage),
  aggregates,
});

describe('stageLabel', () => {
  it('с GROUP BY чип «GROUP BY»', () => {
    expect(stageLabel(groupTrace(['count(*)', 'sum(price)']).stages[1])).toBe('GROUP BY');
  });

  it('агрегат без GROUP BY: имя первой функции, остальные числом', () => {
    expect(stageLabel(aggregateTrace().stages[1])).toBe('COUNT');
    expect(stageLabel(aggregate(['count(*)', 'count(price)']))).toBe('COUNT +1');
    expect(stageLabel(aggregate(['avg(price)', 'min(price)', 'max(price)']))).toBe('AVG +2');
    expect(stageLabel(aggregate(['sum(DISTINCT qty)']))).toBe('SUM');
    expect(stageLabel(aggregate(['pg_catalog.max(price)']))).toBe('MAX');
  });
});
