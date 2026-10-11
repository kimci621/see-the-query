import { describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { filterAnimator } from './filter';
import { projectAnimator } from './project';
import { scanAnimator } from './scan';

function afterWhere(): Frame {
  const t = fullPipelineTrace();
  const s = scanAnimator({ tables: [], decorations: [] }, t.stages[0] as StageOf<'scan'>, 0, testCtx());
  const f = filterAnimator(s[s.length - 1].frame, t.stages[1] as StageOf<'filter'>, 1, testCtx());
  return f[f.length - 1].frame;
}

describe('projectAnimator', () => {
  const stage = fullPipelineTrace().stages[2] as StageOf<'project'>;
  const phases = projectAnimator(afterWhere(), stage, 2, testCtx());

  it('две фазы: разметка и схлопывание', () => {
    expect(phases.map((p) => p.id)).toEqual(['2:mark', '2:collapse']);
  });

  it('убираемая колонка помечена, вычисляемая добавлена со значениями', () => {
    const t = phases[0].frame.tables[0];
    expect(t.columns.map((c) => [c.name, c.state])).toEqual([
      ['book_id', 'removed'],
      ['title', 'normal'],
      ['price', 'normal'],
      ['sale', 'computed'],
    ]);
    const tihiy = t.rows.find((r) => r.key === 'b=(0,1)');
    expect(tihiy?.values).toEqual([1, 'Тихий Дон', '890.00', '801.000']);
  });

  it('после схлопывания колонки как в выходе стадии', () => {
    const t = phases[1].frame.tables[0];
    expect(t.columns.map((c) => c.name)).toEqual(['title', 'price', 'sale']);
    expect(t.columns.find((c) => c.name === 'sale')?.state).toBe('computed');
    expect(t.rows.map((r) => r.values[0])).toEqual([
      'Тихий Дон',
      'Python. К вершинам мастерства',
      'Путешествие к центру Земли',
    ]);
    expect(phases[1].caption).toBe(stage.caption);
  });

  it('переименование подсвечивает исходную колонку', () => {
    const renamed = { ...stage, renamed: { title: 'name' } };
    const p = projectAnimator(afterWhere(), renamed, 2, testCtx());
    expect(p[0].frame.tables[0].columns.find((c) => c.name === 'title')?.state).toBe('highlight');
    expect(p[0].caption).toContain('title → name');
  });
});
