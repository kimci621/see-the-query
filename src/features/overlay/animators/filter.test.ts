import { describe, expect, it } from 'vitest';
import { bigFilterTrace, compressedTrace, fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { filterAnimator } from './filter';
import { scanAnimator } from './scan';

function afterScan(trace = fullPipelineTrace()): Frame {
  const phases = scanAnimator(
    { tables: [], decorations: [] },
    trace.stages[0] as StageOf<'scan'>,
    0,
    testCtx(),
  );
  return phases[phases.length - 1].frame;
}

describe('filterAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[1] as StageOf<'filter'>;
  const phases = filterAnimator(afterScan(), stage, 1, testCtx());

  it('три фазы: проверка, вердикты, отсев', () => {
    expect(phases.map((p) => p.id)).toEqual(['1:check', '1:verdicts', '1:drop']);
  });

  it('подсвечивает колонку условия и ставит сканер на первую строку', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.find((c) => c.name === 'price')?.state).toBe('highlight');
    expect(phases[0].frame.decorations).toContainEqual({ kind: 'scanner', table: 't:b', rowIndex: 0 });
  });

  it('TRUE зелёные, FALSE красные, NULL серые с UNKNOWN', () => {
    const rows = phases[1].frame.tables[0].rows;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['b=(0,1)'].state).toBe('kept');
    expect(byKey['b=(0,3)'].state).toBe('dropped');
    expect(byKey['b=(0,7)'].state).toBe('unknown');
    expect(byKey['b=(0,7)'].badge).toBe('UNKNOWN');
    expect(phases[1].frame.decorations).toContainEqual({ kind: 'scanner', table: 't:b', rowIndex: 4 });
    expect(phases[1].caption).toContain('UNKNOWN');
  });

  it('после отсева остались строки выхода стадии и счётчик 5 → 3', () => {
    const t = phases[2].frame.tables[0];
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']);
    expect(t.rows.every((r) => r.state === 'normal')).toBe(true);
    expect(phases[2].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '5 → 3' }),
    );
    expect(phases[2].caption).toBe(stage.caption);
    expect(t.x).toBe(500);
  });

  it('HAVING подписывается как HAVING', () => {
    const p = filterAnimator(afterScan(), { ...stage, clause: 'having' }, 1, testCtx());
    expect(p[0].caption.startsWith('HAVING')).toBe(true);
  });

  it('сжатый режим: счётчик показывает настоящие числа', () => {
    const big = bigFilterTrace(2000);
    const p = filterAnimator(afterScan(big), big.stages[1] as StageOf<'filter'>, 1, testCtx());
    const last = p[p.length - 1].frame;
    expect(last.tables[0].rows).toHaveLength(20);
    expect(last.tables[0].hiddenRows).toBe(980);
    expect(last.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '2000 → 1000' }),
    );
  });

  it('сжатый режим Ф5: вердиктов нет, одна фаза с итогом и точным счётчиком', () => {
    const big = compressedTrace(5000);
    const p = filterAnimator(afterScan(big), big.stages[1] as StageOf<'filter'>, 1, testCtx());
    expect(p.map((x) => x.id)).toEqual(['1:drop']);
    expect(p[0].frame.tables[0].hiddenRows).toBe(2500);
    expect(p[0].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '5000 → 2500' }),
    );
  });

  it('без рабочей таблицы ничего не ломает', () => {
    const p = filterAnimator({ tables: [], decorations: [] }, stage, 1, testCtx());
    expect(p).toHaveLength(1);
    expect(p[0].frame.tables[0].rows).toHaveLength(3);
  });
});
