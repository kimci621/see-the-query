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

  it('ключ подсвечен и после переезда', () => {
    const t = phases[1].frame.tables[0];
    expect(t.columns.filter((c) => c.state === 'key').map((c) => c.name)).toEqual(['price']);
  });

  it('ключ по номерам колонок трассировщика, текст ключа не разбирается: order by 2, b.price, lower(title)', () => {
    for (const [sortKeys, keyColumns, names] of [
      [['2'], [1], ['price']],
      [['b.price DESC'], [1], ['price']],
      [['lower(title)'], [0], ['title']],
    ] as const) {
      const s = { ...stage, sortKeys: [...sortKeys], keyColumns: [...keyColumns] };
      const p = sortAnimator(runUpTo(trace, 3, testCtx()), s, 3, testCtx());
      for (const phase of p) {
        const keys = phase.frame.tables[0].columns.filter((c) => c.state === 'key').map((c) => c.name);
        expect(keys, `${sortKeys} ${phase.id}`).toEqual(names);
      }
    }
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
