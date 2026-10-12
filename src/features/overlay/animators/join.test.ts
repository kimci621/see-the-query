import { describe, expect, it } from 'vitest';
import { runUpTo } from '../__fixtures__/runUpTo';
import { crossJoinTrace, joinTrace, testCtx } from '../__fixtures__/traces';
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

describe('joinAnimator: LEFT / RIGHT / FULL', () => {
  const run = (type: 'left' | 'right' | 'full') => {
    const trace = joinTrace(type);
    const stage = trace.stages[2] as StageOf<'join'>;
    const before = runUpTo(trace, 2, testCtx());
    return { before, phases: joinAnimator(before, stage, 2, testCtx()) };
  };
  const rowOf = (
    phase: { frame: { tables: { id: string; rows: { key: string }[] }[] } },
    id: string,
    key: string,
  ) =>
    phase.frame.tables.find((t) => t.id === id)?.rows.find((r) => r.key === key) as
      | { state: string; values: unknown[] }
      | undefined;

  it('LEFT: левая строка без пары остаётся с NULL-половиной, правые без пары уходят', () => {
    const { phases } = run('left');
    expect(rowOf(phases[2], 't:b', 'b=(0,10)')?.state).toBe('null-filled');
    expect(rowOf(phases[2], 't:a', 'a=(0,6)')?.state).toBe('dropped');
    const noPair = rowOf(phases[3], 't:b|a', 'b=(0,10)|a=∅');
    expect(noPair?.state).toBe('null-filled');
    expect(noPair?.values.slice(3)).toEqual([null, null]);
    expect(rowOf(phases[3], 't:b|a', 'b=(0,1)|a=(0,1)')?.state).toBe('normal');
  });
  it('RIGHT: зеркально, левая таблица подъезжает к правой, правая без пары остаётся', () => {
    const { before, phases } = run('right');
    const [left, right] = phases[0].frame.tables;
    expect(right.x).toBe(before.tables[1].x);
    expect(left.x).toBeGreaterThan(before.tables[0].x);
    expect(rowOf(phases[2], 't:b', 'b=(0,10)')?.state).toBe('dropped');
    const noPair = rowOf(phases[3], 't:b|a', 'b=∅|a=(0,6)');
    expect(noPair?.state).toBe('null-filled');
    expect(noPair?.values.slice(0, 3)).toEqual([null, null, null]);
  });
  it('FULL: обе стороны без пар остаются', () => {
    const { phases } = run('full');
    expect(rowOf(phases[3], 't:b|a', 'b=(0,10)|a=∅')?.state).toBe('null-filled');
    expect(rowOf(phases[3], 't:b|a', 'b=∅|a=(0,6)')?.state).toBe('null-filled');
    expect(phases[3].frame.tables[0].rows).toHaveLength(5);
  });
});

describe('joinAnimator: CROSS', () => {
  const run = (n: number, m: number) => {
    const trace = crossJoinTrace(n, m);
    const stage = trace.stages[2] as StageOf<'join'>;
    return { stage, phases: joinAnimator(runUpTo(trace, 2, testCtx()), stage, 2, testCtx()) };
  };

  it('веер линий от каждой левой строки ко всем правым, затем сетка со счётчиком', () => {
    const { stage, phases } = run(3, 2);
    expect(phases.map((p) => p.id)).toEqual(['2:fan', '2:grid']);
    const fan = phases[0].frame.decorations.flatMap((d) => (d.kind === 'pair-line' ? [d] : []));
    expect(fan).toHaveLength(6);
    expect(fan.filter((l) => l.from.row === 'b=(0,1)')).toHaveLength(2);
    const grid = phases[1].frame.tables;
    expect(grid.map((t) => t.id)).toEqual(['t:b|c']);
    expect(grid[0].rows).toHaveLength(6);
    expect(phases[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '3 × 2 = 6' }),
    );
    expect(phases[1].caption).toBe(stage.caption);
  });
  it('большая сетка: сжатый вид и не больше сотни линий веера', () => {
    const { phases } = run(11, 20);
    expect(phases[0].frame.decorations.filter((d) => d.kind === 'pair-line').length).toBeLessThanOrEqual(100);
    const grid = phases[1].frame.tables[0];
    expect(grid.rows).toHaveLength(20);
    expect(grid.hiddenRows).toBe(200);
    expect(phases[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '11 × 20 = 220' }),
    );
  });
});
