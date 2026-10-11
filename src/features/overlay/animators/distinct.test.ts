import { describe, expect, it } from 'vitest';
import { compressedTrace, distinctTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { distinctAnimator } from './distinct';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';

function afterProject(): Frame {
  const t = distinctTrace();
  const s = scanAnimator({ tables: [], decorations: [] }, t.stages[0] as StageOf<'scan'>, 0, testCtx());
  const p = projectAnimator(s[s.length - 1].frame, t.stages[1] as StageOf<'project'>, 1, testCtx());
  return p[p.length - 1].frame;
}

describe('distinctAnimator', () => {
  const stage = distinctTrace().stages[2] as StageOf<'distinct'>;
  const phases = distinctAnimator(afterProject(), stage, 2, testCtx());

  it('дубли съезжаются под победителя', () => {
    const rows = phases[0].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,8)', 'b=(0,9)', 'b=(0,7)']);
    const winner = rows.find((r) => r.key === 'b=(0,8)');
    const loser = rows.find((r) => r.key === 'b=(0,9)');
    expect(winner).toMatchObject({ state: 'kept', badge: '×2' });
    expect(loser?.state).toBe('dropped');
    expect(winner?.group).toBe(loser?.group);
    expect(rows.find((r) => r.key === 'b=(0,1)')?.group).toBeUndefined();
  });

  it('после схлопывания остались победители, бейдж сохранился', () => {
    const rows = phases[1].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,8)', 'b=(0,7)']);
    expect(rows[1].badge).toBe('×2');
    expect(rows[0].badge).toBeUndefined();
  });

  it('сжатый режим Ф5: одна фаза с итогом, скрытые строки по rowCount', () => {
    const scan = compressedTrace(5000).stages[0];
    const s0 = scanAnimator({ tables: [], decorations: [] }, scan as StageOf<'scan'>, 0, testCtx());
    const big = {
      ...stage,
      stacks: [],
      compressed: true,
      rowCount: 40,
      output: { ...stage.output, rows: [] },
    };
    const p = distinctAnimator(s0[s0.length - 1].frame, big, 1, testCtx());
    expect(p.map((x) => x.id)).toEqual(['1:collapse']);
    expect(p[0].frame.tables[0].hiddenRows).toBe(40);
  });

  it('DISTINCT ON упоминает ключи в подписи', () => {
    const p = distinctAnimator(afterProject(), { ...stage, on: ['price'] }, 2, testCtx());
    expect(p[0].caption).toContain('DISTINCT ON (price)');
  });
});
