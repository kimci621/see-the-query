import { describe, expect, it } from 'vitest';
import type { Relation, Trace } from '@/features/tracer/types';
import { testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { setopAnimator } from './setop';

const rel = (values: unknown[][]): Relation => ({
  columns: [{ name: 'name', type: 'text' }],
  rows: values.map((v, i) => ({ key: `r:${i}`, lineage: {}, values: v })),
});

const trace = (values: unknown[][]): Trace => ({
  sql: '',
  statementType: 'select',
  mode: 'full',
  touched: { tableIds: [], columns: [] },
  stages: [
    {
      id: '0:project',
      kind: 'project',
      kept: [],
      removed: [],
      computed: ['name'],
      renamed: {},
      caption: 'SELECT',
      output: rel(values),
    },
  ],
  result: null,
  error: null,
  notices: [],
  timingMs: 0,
});

const stage = (op: StageOf<'setop'>['op'], left: unknown[][], right: unknown[][]): StageOf<'setop'> => {
  const result =
    op === 'union all'
      ? [...left, ...right]
      : op === 'except'
        ? left.filter((row) => !right.some((r) => r[0] === row[0]))
        : left;
  return {
    id: '0:setop',
    kind: 'setop',
    op,
    branches: [trace(left), trace(right)],
    caption: `${op.toUpperCase()}: ${result.length} строк`,
    output: rel(result),
  };
};

describe('setopAnimator', () => {
  it('UNION ALL: ветви встают друг под другом, затем общий итог', () => {
    const phases = setopAnimator(
      { tables: [], decorations: [] },
      stage('union all', [[1], [2]], [[2], [3]]),
      0,
      testCtx(),
    );
    expect(phases.map((p) => p.id)).toEqual(['0:branches', '0:stack', '0:result']);
    expect(phases[0].frame.tables.map((t) => t.title)).toEqual(['левая ветвь', 'правая ветвь']);
    expect(phases[2].frame.tables[0].rows).toHaveLength(4);
  });

  it('UNION: дубли схлопываются с бейджем ×2', () => {
    const phases = setopAnimator(
      { tables: [], decorations: [] },
      stage('union', [[1], [2]], [[2], [3]]),
      0,
      testCtx(),
    );
    const dedupe = phases[1].frame.tables[0];
    expect(dedupe.rows.find((r) => r.values[0] === 2)?.badge).toBe('×2');
    const result = phases[2].frame.tables[0];
    expect(result.rows.find((r) => r.values[0] === 2)?.badge).toBe('×2 → 1');
  });

  it('INTERSECT: строки-близнецы соединены линиями', () => {
    const phases = setopAnimator(
      { tables: [], decorations: [] },
      stage('intersect', [[1], [2]], [[2], [3]]),
      0,
      testCtx(),
    );
    expect(phases[1].frame.decorations.filter((d) => d.kind === 'pair-line')).toHaveLength(1);
  });

  it('EXCEPT: найденные справа строки гаснут', () => {
    const phases = setopAnimator(
      { tables: [], decorations: [] },
      stage('except', [[1], [2]], [[2]]),
      0,
      testCtx(),
    );
    const cut = phases[1].frame.tables[0];
    expect(cut.rows.find((r) => r.values[0] === 2)?.state).toBe('dropped');
    expect(phases[2].frame.tables[0].rows.map((r) => r.values[0])).toEqual([1]);
  });
});
