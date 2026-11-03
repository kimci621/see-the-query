import { describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { bookScan, testCtx } from '../__fixtures__/traces';
import { rebuildTable } from '../frame';
import type { StageOf } from '../types';
import { subqueryAnimator } from './subquery';

const scan = bookScan();
const prev = {
  tables: [rebuildTable({ id: 'b', title: 'book', x: 0, y: 0 }, scan.output)],
  decorations: [],
};
const inner: Trace = {
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
      computed: ['max'],
      renamed: {},
      caption: 'SELECT',
      output: {
        columns: [{ name: 'max', type: 'numeric' }],
        rows: [{ key: 'r:0', lineage: {}, values: ['3200.00'] }],
      },
    },
  ],
  result: null,
  error: null,
  notices: [],
  timingMs: 0,
};

const base: StageOf<'subquery'> = {
  id: '1:subquery',
  kind: 'subquery',
  mode: 'scalar',
  samples: [],
  limit3: false,
  caption: 'Подзапрос: одно значение 3200.00',
  output: scan.output,
};

describe('subqueryAnimator', () => {
  it('скалярный подзапрос схлопывается в маленькую таблицу со значением', () => {
    const phases = subqueryAnimator(prev, { ...base, value: '3200.00' }, 1, testCtx());
    expect(phases).toHaveLength(1);
    const mini = phases[0].frame.tables.at(-1);
    expect(mini).toMatchObject({ title: 'подзапрос', dashed: true });
    expect(mini?.rows[0].values).toEqual(['3200.00']);
    expect(phases[0].frame.decorations.some((d) => d.kind === 'arrow')).toBe(true);
  });

  it('IN: вердикты красят строки, UNKNOWN получает бейдж', () => {
    const verdicts = {
      'b=(0,1)': true,
      'b=(0,2)': false,
      'b=(0,3)': null,
      'b=(0,7)': true,
      'b=(0,8)': false,
    } as const;
    const phases = subqueryAnimator(
      prev,
      { ...base, mode: 'in', caption: 'IN: совпало 2', verdicts },
      1,
      testCtx(),
    );
    const rows = phases[0].frame.tables[0].rows;
    expect(rows.find((r) => r.key === 'b=(0,1)')?.state).toBe('kept');
    expect(rows.find((r) => r.key === 'b=(0,2)')?.state).toBe('dropped');
    expect(rows.find((r) => r.key === 'b=(0,3)')?.badge).toBe('UNKNOWN');
    expect(phases[1].frame.tables[0].rows).toHaveLength(5);
  });

  it('коррелированный подзапрос: до трёх мини-сцен с стрелками', () => {
    const samples = ['b=(0,1)', 'b=(0,2)', 'b=(0,3)'].map((outer) => ({ outer, inner }));
    const phases = subqueryAnimator(
      prev,
      { ...base, mode: 'correlated', samples, limit3: true, caption: 'Коррелированный подзапрос: 3 строки' },
      1,
      testCtx(),
    );
    expect(phases).toHaveLength(3);
    expect(phases[2].frame.tables.filter((t) => t.dashed)).toHaveLength(3);
    expect(phases[2].frame.decorations.filter((d) => d.kind === 'arrow')).toHaveLength(3);
  });

  it('LATERAL заканчивается склеенным итогом', () => {
    const samples = [{ outer: 'b=(0,1)', inner }];
    const result = {
      columns: [...scan.output.columns, { name: 'title', type: 'text' }],
      rows: scan.output.rows.map((r) => ({ ...r, values: [...r.values, 'книга'] })),
    };
    const phases = subqueryAnimator(
      prev,
      { ...base, mode: 'lateral', samples, limit3: true, output: result, caption: 'LATERAL: 5 строк' },
      1,
      testCtx(),
    );
    expect(phases.at(-1)?.id).toBe('1:lateral-result');
    expect(phases.at(-1)?.frame.tables[0].rows[0].values.at(-1)).toBe('книга');
  });
});
