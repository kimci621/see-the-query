import { describe, expect, it } from 'vitest';
import { runUpTo } from '../__fixtures__/runUpTo';
import { joinTrace, testCtx } from '../__fixtures__/traces';
import { ghostWidth } from '../geometry';
import type { StageOf } from '../types';
import { joinAnimator } from './join';

describe('joinAnimator: INNER', () => {
  const trace = joinTrace();
  const stage = trace.stages[2] as StageOf<'join'>;
  const before = runUpTo(trace, 2, testCtx());
  const phases = joinAnimator(before, stage, 2, testCtx());

  it('четыре фазы: сближение, линии, отсев, слияние', () => {
    expect(phases.map((p) => p.id)).toEqual(['2:approach', '2:lines', '2:unmatched', '2:merge']);
    expect(phases.every((p) => p.stageIndex === 2)).toBe(true);
    expect(phases.every((p) => p.durationMs >= 400 && p.durationMs <= 900)).toBe(true);
  });
  it('сближение: правая таблица подъехала ближе, но не наехала на левую', () => {
    const [left, right] = phases[0].frame.tables;
    expect(right.x).toBeGreaterThan(left.x + ghostWidth(left));
    expect(right.x).toBeLessThan(before.tables[1].x);
    expect(right.y).toBe(left.y);
  });
  it('линии пар между ячейками ключей', () => {
    const lines = phases[1].frame.decorations.filter((d) => d.kind === 'pair-line');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      from: { table: 't:b', row: 'b=(0,1)', col: 'author_id' },
      to: { table: 't:a', row: 'a=(0,1)', col: 'author_id' },
    });
  });
  it('непарные строки краснеют с обеих сторон', () => {
    const { tables } = phases[2].frame;
    const b = tables.find((t) => t.id === 't:b');
    const a = tables.find((t) => t.id === 't:a');
    expect(b?.rows.find((r) => r.key === 'b=(0,10)')?.state).toBe('dropped');
    expect(a?.rows.find((r) => r.key === 'a=(0,6)')?.state).toBe('dropped');
    expect(b?.rows.find((r) => r.key === 'b=(0,1)')?.state).toBe('matched');
  });
  it('слияние: одна таблица-результат, ключи строк склеены, клон с бейджем', () => {
    const { tables } = phases[3].frame;
    expect(tables.map((t) => t.id)).toEqual(['t:b|a']);
    expect(tables[0].title).toBe('book b + author a');
    const { rows } = tables[0];
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)|a=(0,1)', 'b=(0,3)|a=(0,1)', 'b=(0,4)|a=(0,3)']);
    // автор a=(0,1) встретился в двух парах: обе строки-клона с бейджем ×2
    expect(rows.map((r) => r.badge)).toEqual(['×2', '×2', undefined]);
    expect(phases[3].caption).toBe(stage.caption);
  });
  it('следующая стадия работает с таблицей-результатом', () => {
    const after = runUpTo(trace, 4, testCtx());
    expect(after.tables.map((t) => t.id)).toEqual(['t:b|a']);
    expect(after.tables[0].columns.map((c) => c.name)).toEqual(['title', 'name']);
  });
  it('пустой кадр не ломает аниматор', () => {
    const p = joinAnimator({ tables: [], decorations: [] }, stage, 2, testCtx());
    expect(p[p.length - 1].frame.tables.at(-1)?.rows).toHaveLength(3);
  });
});
