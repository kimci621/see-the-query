import { describe, expect, it } from 'vitest';
import type { Relation } from '@/features/tracer/types';
import { testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { recursionAnimator } from './recursion';

const rel = (n: number): Relation => ({
  columns: [{ name: 'employee_id', type: 'int4' }],
  rows: Array.from({ length: n }, (_, i) => ({
    key: `r:${i}`,
    lineage: {},
    values: [i + 1],
  })),
});

const stage = (iterations: number[]): StageOf<'recursion'> => ({
  id: '0:recursion',
  kind: 'recursion',
  name: 't',
  iterations: iterations.map(rel),
  caption: `WITH RECURSIVE t: ${iterations.length} итераций, ${iterations.reduce((a, b) => a + b, 0)} строк`,
  output: rel(iterations.reduce((a, b) => a + b, 0)),
});

describe('recursionAnimator', () => {
  it('якорь и шаги идут слоями, стрелки ведут вниз', () => {
    const phases = recursionAnimator({ tables: [], decorations: [] }, stage([1, 2, 3, 1, 0]), 0, testCtx());
    expect(phases).toHaveLength(6);
    expect(phases[0].caption).toBe('якорь: 1 строка');
    expect(phases[1].caption).toBe('шаг 1: 2 строки');
    expect(phases[1].frame.tables.map((t) => t.title)).toEqual(['якорь: t', 'шаг 1: t']);
    expect(phases[1].frame.decorations.some((d) => d.kind === 'arrow')).toBe(true);
    expect(phases.at(-1)?.caption).toContain('строк');
  });

  it('больше пяти слоёв: первые три подробно, остальные в счётчике', () => {
    const phases = recursionAnimator(
      { tables: [], decorations: [] },
      stage([1, 2, 3, 4, 5, 6, 7, 8]),
      0,
      testCtx(),
    );
    expect(phases).toHaveLength(4);
    expect(phases[3].caption).toContain('ещё 5 шагов');
    expect(phases[3].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: 'ещё 5 слоёв' }),
    );
  });
});
