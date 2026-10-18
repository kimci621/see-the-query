import { describe, expect, it } from 'vitest';
import { runUpTo } from '../__fixtures__/runUpTo';
import { fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { limitAnimator } from './limit';

describe('limitAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[4] as StageOf<'limit'>;
  const before = runUpTo(trace, 4, testCtx());

  it('ножницы после второй строки, третья отрезана', () => {
    const phases = limitAnimator(before, stage, 4, testCtx());
    expect(phases[0].frame.decorations).toContainEqual({ kind: 'scissors', table: 't:b', afterRow: 1 });
    expect(phases[0].frame.tables[0].rows.find((r) => r.key === 'b=(0,8)')?.state).toBe('cut');
    expect(phases[1].frame.tables[0].rows.map((r) => r.key)).toEqual(['b=(0,2)', 'b=(0,1)']);
    expect(phases[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '3 → 2' }),
    );
  });

  it('OFFSET даёт вторые ножницы сверху', () => {
    const withOffset = { ...stage, offset: 1, limit: 1, kept: ['b=(0,1)'], cut: ['b=(0,2)', 'b=(0,8)'] };
    const phases = limitAnimator(before, withOffset, 4, testCtx());
    const scissors = phases[0].frame.decorations.filter((d) => d.kind === 'scissors');
    expect(scissors).toEqual([
      { kind: 'scissors', table: 't:b', afterRow: 0 },
      { kind: 'scissors', table: 't:b', afterRow: 1 },
    ]);
    expect(phases[0].caption).toBe('LIMIT 1 OFFSET 1: отрезаем лишнее');
  });

  it('строки kept не подряд (окно по порядку эталона): без ножниц, только cut', () => {
    const scattered = { ...stage, kept: ['b=(0,2)', 'b=(0,8)'], cut: ['b=(0,1)'] };
    const phases = limitAnimator(before, scattered, 4, testCtx());
    expect(phases[0].frame.decorations.filter((d) => d.kind === 'scissors')).toEqual([]);
    expect(phases[0].frame.tables[0].rows.find((r) => r.key === 'b=(0,1)')?.state).toBe('cut');
  });

  it('WITH TIES: ножницы после последней оставленной строки, а не после limit', () => {
    const ties = { ...stage, limit: 1, kept: ['b=(0,2)', 'b=(0,1)'], cut: ['b=(0,8)'] };
    const phases = limitAnimator(before, ties, 4, testCtx());
    expect(phases[0].frame.decorations.filter((d) => d.kind === 'scissors')).toEqual([
      { kind: 'scissors', table: 't:b', afterRow: 1 },
    ]);
  });

  it('LIMIT больше числа строк не рисует нижние ножницы', () => {
    const all = { ...stage, limit: 10, kept: ['b=(0,2)', 'b=(0,1)', 'b=(0,8)'], cut: [] };
    const phases = limitAnimator(before, all, 4, testCtx());
    expect(phases[0].frame.decorations.filter((d) => d.kind === 'scissors')).toEqual([]);
  });
});
