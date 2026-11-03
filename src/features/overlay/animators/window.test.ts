import { describe, expect, it } from 'vitest';
import type { Relation } from '@/features/tracer/types';
import { bookScan, testCtx } from '../__fixtures__/traces';
import { rebuildTable } from '../frame';
import type { GhostTable, StageOf } from '../types';
import { windowAnimator } from './window';

const scan = bookScan();

const prev = {
  tables: [rebuildTable({ id: 'b', title: 'book', x: 0, y: 0 }, scan.output)],
  decorations: [],
};

const output: Relation = {
  columns: [...scan.output.columns, { name: 'row_number', type: 'int8' }],
  rows: scan.output.rows.map((r, i) => ({ ...r, values: [...r.values, i + 1] })),
};

const stage: StageOf<'window'> = {
  id: '1:window',
  kind: 'window',
  partitions: [{ members: ['b=(0,1)', 'b=(0,2)', 'b=(0,3)'] }, { members: ['b=(0,7)', 'b=(0,8)'] }],
  computed: ['row_number'],
  functions: ['row_number'],
  orderKeys: ['price'],
  frame: 'ROWS BETWEEN 1 PRECEDING AND CURRENT ROW',
  caption: 'ОКНО row_number: 5 строк, строки не схлопываются',
  output,
};

describe('windowAnimator', () => {
  it('строки окрашиваются по партициям и не схлопываются', () => {
    const phases = windowAnimator(prev, stage, 1, testCtx());
    const first = phases[0];
    expect(first.frame.tables[0].rows.map((r) => r.group)).toEqual([0, 0, 0, 1, 1]);
    expect(first.frame.tables[0].rows).toHaveLength(5);
    expect(first.frame.decorations).toEqual([]);
  });

  it('рамка едет по строкам партиции', () => {
    const phases = windowAnimator(prev, stage, 1, testCtx());
    const frames = phases.filter((p) => p.id.includes(':frame:'));
    expect(frames.length).toBe(3);
    expect(frames[0].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'bracket', fromRow: 0, toRow: 0, label: 'рамка' }),
    );
    expect(frames[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'bracket', fromRow: 0, toRow: 1 }),
    );
  });

  it('вычисленная колонка появляется отдельной фазой', () => {
    const phases = windowAnimator(prev, stage, 1, testCtx());
    const last = phases.at(-1) as { frame: { tables: GhostTable[] } };
    const table = last.frame.tables[0];
    expect(table.columns.map((c) => c.name)).toEqual(['book_id', 'title', 'price', 'row_number']);
    expect(table.columns.at(-1)?.state).toBe('computed');
    expect(table.rows[0].values.at(-1)).toBe(1);
  });

  it('ничьи по ключу окна помечаются', () => {
    const duplicate: Relation = {
      columns: scan.output.columns,
      rows: scan.output.rows.map((r, i) => ({
        ...r,
        values: i === 3 ? [r.values[0], r.values[1], '610.00', ...r.values.slice(3)] : r.values,
      })),
    };
    const tiePrev = {
      tables: [rebuildTable({ id: 'b', title: 'book', x: 0, y: 0 }, duplicate)],
      decorations: [],
    };
    const ties: StageOf<'window'> = {
      ...stage,
      functions: ['rank'],
      computed: ['rank'],
      orderKeys: ['price'],
      output: {
        columns: [...duplicate.columns, { name: 'rank', type: 'int8' }],
        rows: duplicate.rows.map((r, i) => ({ ...r, values: [...r.values, i + 1] })),
      },
      frame: undefined,
    };
    const phases = windowAnimator(tiePrev, ties, 1, testCtx());
    const tie = phases.find((p) => p.id.includes(':ties'));
    expect(tie?.frame.tables[0].rows.filter((r) => r.badge === 'ничья')).toHaveLength(2);
  });
});
