import { describe, expect, it } from 'vitest';
import { testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { expandAnimator } from './expand';

const prev: Frame = {
  tables: [
    {
      id: 't:b',
      title: 'book b',
      x: 500,
      y: 0,
      columns: [{ name: 'tags', type: 'text', source: { alias: 'b', column: 'tags' }, state: 'normal' }],
      rows: [
        { key: 'b=(0,1)', values: [['a', 'b']], state: 'normal' },
        { key: 'b=(0,2)', values: [[]], state: 'normal' },
      ],
    },
  ],
  decorations: [],
};
const stage: StageOf<'expand'> = {
  id: 's1',
  kind: 'expand',
  fn: 'unnest',
  alias: 'u',
  sourceAlias: 'b',
  sourceColumn: 'tags',
  caption: 'unnest: 2 строки → 2 строки',
  children: [{ parent: 'b=(0,1)', keys: ['#1', '#2'] }],
  output: {
    columns: [
      { name: 'tags', type: 'text', source: { alias: 'b', column: 'tags' } },
      { name: 'tag', type: 'text', source: { alias: 'u', column: 'tag' } },
    ],
    rows: [
      { key: 'b=(0,1)|u=#1', lineage: { b: '(0,1)', u: '#1' }, values: [['a', 'b'], 'a'] },
      { key: 'b=(0,1)|u=#2', lineage: { b: '(0,1)', u: '#2' }, values: [['a', 'b'], 'b'] },
    ],
  },
};

describe('expandAnimator', () => {
  it('показывает источник, потомков и общую таблицу для следующей стадии', () => {
    const phases = expandAnimator(prev, stage, 1, testCtx());
    expect(phases.length).toBeGreaterThanOrEqual(3);
    const source = phases[0].frame.tables.find((t) => t.id === 't:b');
    expect(source?.columns[0].state).toBe('highlight');
    expect(source?.rows.map((row) => row.badge)).toEqual(['2 элемента', '0 элементов']);
    const child = phases
      .flatMap((phase) => phase.frame.tables)
      .find((t) => t.id === 't:u' && t.rows.length === 2);
    expect(child?.columns.map((column) => column.name)).toEqual(['tag']);
    expect(child?.rows.map((row) => row.values)).toEqual([['a'], ['b']]);
    expect(child?.rows[0].origin?.x).toBeLessThan(0);
    expect(phases.some((phase) => phase.frame.decorations.some((d) => d.kind === 'bracket'))).toBe(true);
    expect(phases.some((phase) => phase.frame.decorations.some((d) => d.kind === 'counter'))).toBe(true);
    const last = phases.at(-1)?.frame.tables.at(-1);
    expect(last?.rows.map((row) => row.key)).toEqual(stage.output.rows.map((row) => row.key));
    expect(last?.columns.map((column) => column.name)).toEqual(['tags', 'tag']);
  });

  it('в длинном раскрытии камера оставляет текст читаемым, сохраняя все строки', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      key: `b=(0,1)|u=#${i + 1}`,
      lineage: { b: '(0,1)', u: `#${i + 1}` },
      values: [['a'], String(i)],
    }));
    const longStage = { ...stage, output: { ...stage.output, rows } };
    const phases = expandAnimator(prev, longStage, 1, testCtx());
    const links = phases.find((phase) => phase.id === '1:links');
    expect(links?.frame.camera?.height).toBeLessThan(21 * 24 + 76);
    expect(links?.frame.tables.find((table) => table.id === 't:u')?.rows).toHaveLength(21);
  });

  it('jsonb_each показывает ключи и значения отдельными колонками', () => {
    const jsonStage: StageOf<'expand'> = {
      ...stage,
      fn: 'jsonb_each',
      alias: 's',
      sourceColumn: 'settings',
      output: {
        columns: [
          { name: 'settings', type: 'text', source: { alias: 'b', column: 'settings' } },
          { name: 'key', type: 'text', source: { alias: 's', column: 'key' } },
          { name: 'value', type: 'text', source: { alias: 's', column: 'value' } },
        ],
        rows: [{ key: 'b=(0,1)|s=#1', lineage: { b: '(0,1)', s: '#1' }, values: [{ a: 1 }, 'a', 1] }],
      },
      children: [{ parent: 'b=(0,1)', keys: ['#1'] }],
    };
    const jsonPrev = {
      ...prev,
      tables: [
        {
          ...prev.tables[0],
          columns: [
            {
              name: 'settings',
              type: 'text',
              source: { alias: 'b', column: 'settings' },
              state: 'normal' as const,
            },
          ],
        },
      ],
    };
    const phases = expandAnimator(jsonPrev, jsonStage, 1, testCtx());
    const child = phases
      .flatMap((phase) => phase.frame.tables)
      .find((t) => t.id === 't:s' && t.rows.length === 1);
    expect(child?.columns.map((column) => column.name)).toEqual(['key', 'value']);
    expect(child?.rows.map((row) => row.values)).toEqual([['a', 1]]);
  });
});
