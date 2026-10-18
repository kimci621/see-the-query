import { describe, expect, it } from 'vitest';
import { runUpTo } from '../__fixtures__/runUpTo';
import { compressedTrace, fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { sortAnimator } from './sort';

describe('sortAnimator', () => {
  const trace = fullPipelineTrace();
  const stage = trace.stages[3] as StageOf<'sort'>;
  const phases = sortAnimator(runUpTo(trace, 3, testCtx()), stage, 3, testCtx());

  it('сначала подсвечивает ключ сортировки, порядок ещё старый', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.find((c) => c.name === 'price')?.state).toBe('key');
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']);
  });

  it('потом строки переезжают в порядок стадии', () => {
    const t = phases[1].frame.tables[0];
    expect(t.rows.map((r) => r.key)).toEqual(['b=(0,2)', 'b=(0,1)', 'b=(0,8)']);
    expect(phases[1].caption).toBe('ORDER BY price DESC');
  });

  it('ключ Ф5 это SQL-текст: «price DESC» подсвечивает колонку price', () => {
    const t = phases[1].frame.tables[0];
    expect(t.columns.filter((c) => c.state === 'key').map((c) => c.name)).toEqual(['price']);
  });

  it('сжатый режим Ф5: одна фаза, строки по rowCount', () => {
    const big = compressedTrace(5000);
    const s = {
      ...stage,
      order: [],
      compressed: true,
      rowCount: 2500,
      output: { ...stage.output, rows: [] },
    };
    const p = sortAnimator(runUpTo(big, 2, testCtx()), s, 2, testCtx());
    expect(p.map((x) => x.id)).toEqual(['2:reorder']);
    expect(p[0].frame.tables[0].hiddenRows).toBe(2500);
  });
});
