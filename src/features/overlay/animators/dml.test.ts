import { describe, expect, it } from 'vitest';
import { bookScan, testCtx } from '../__fixtures__/traces';
import type { Frame, StageOf } from '../types';
import { dmlAnimator } from './dml';

const stage = (overrides: Partial<StageOf<'dml'>> = {}): StageOf<'dml'> => ({
  id: 'dml',
  kind: 'dml',
  op: 'insert',
  tableId: 'public.book',
  inserted: ['b=(0,8)'],
  deleted: [],
  updated: [],
  conflicts: [],
  mergeBranches: {},
  cascades: [],
  defaulted: ['book_id'],
  caption: 'INSERT',
  output: bookScan().output,
  ...overrides,
});

describe('dmlAnimator', () => {
  it('INSERT строит призрак на цели и помечает новую строку с DEFAULT', () => {
    const [phase] = dmlAnimator({ tables: [], decorations: [] }, stage(), 0, testCtx());
    expect(phase.frame.tables[0]).toMatchObject({ id: 't:public.book', x: 0, y: 0 });
    const row = phase.frame.tables[0].rows.find((item) => item.key === 'b=(0,8)');
    expect(row?.state).toBe('new');
    expect(row?.cellMarks).toEqual({ 0: 'default' });
  });

  it('UPDATE выделяет изменённую строку и ячейку', () => {
    const phases = dmlAnimator(
      { tables: [], decorations: [] },
      stage({
        op: 'update',
        inserted: [],
        defaulted: undefined,
        updated: [
          {
            key: 'b=(0,1)',
            before: [1, 'Тихий Дон', '890.00'],
            after: [1, 'Тихий Дон', '700.00'],
            changedColumns: ['price'],
          },
        ],
      }),
      0,
      testCtx(),
    );
    expect(phases.map((phase) => phase.id)).toEqual(['0:update-before', '0:dml']);
    const phase = phases[1];
    const row = phase.frame.tables[0].rows.find((item) => item.key === 'b=(0,1)');
    expect(row?.state).toBe('changed');
    expect(row?.cellMarks).toEqual({ 2: 'changed' });
  });

  it('DELETE перечёркивает удаляемую строку', () => {
    const [phase] = dmlAnimator(
      { tables: [], decorations: [] },
      stage({ op: 'delete', inserted: [], deleted: ['b=(0,1)'], defaulted: undefined }),
      0,
      testCtx(),
    );
    expect(phase.frame.tables[0].rows.find((item) => item.key === 'b=(0,1)')?.state).toBe('deleted');
  });

  it('TRUNCATE гасит все строки одним кадром, без зачёркивания', () => {
    const [phase] = dmlAnimator(
      { tables: [], decorations: [] },
      stage({ op: 'truncate', inserted: [], deleted: BOOK_KEYS, defaulted: undefined }),
      0,
      testCtx(),
    );
    expect(phase.frame.tables[0].rows.every((row) => row.state === 'cut')).toBe(true);
  });

  it('MERGE подписывает ветки на строках цели', () => {
    const [phase] = dmlAnimator(
      { tables: [], decorations: [] },
      stage({
        op: 'merge',
        inserted: ['b=(0,8)'],
        deleted: ['b=(0,3)'],
        defaulted: undefined,
        mergeBranches: {
          'b=(0,1)': 'matched_update',
          'b=(0,3)': 'matched_delete',
          'b=(0,8)': 'not_matched_insert',
        },
      }),
      0,
      testCtx(),
    );
    const rows = Object.fromEntries(phase.frame.tables[0].rows.map((row) => [row.key, row]));
    expect(rows['b=(0,1)']).toMatchObject({ state: 'matched', badge: 'UPDATE' });
    expect(rows['b=(0,3)']).toMatchObject({ state: 'deleted', badge: 'DELETE' });
    expect(rows['b=(0,8)']).toMatchObject({ state: 'new', badge: 'INSERT' });
  });

  it('каскад идёт отдельной фазой по стрелке FK', () => {
    const phases = dmlAnimator(
      { tables: [], decorations: [] },
      stage({
        op: 'delete',
        inserted: [],
        deleted: ['b=(0,1)'],
        defaulted: undefined,
        cascades: [{ tableId: 'public.author', deleted: ['a=(0,1)'], updated: [] }],
      }),
      0,
      testCtx({
        'public.book': { x: 0, y: 0, width: 260, height: 400 },
        'public.author': { x: 400, y: 0, width: 260, height: 400 },
      }),
    );
    expect(phases).toHaveLength(2);
    expect(phases[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'arrow', tone: 'info' }),
    );
  });

  it('INSERT SELECT держит источник и проводит линию к конфликту', () => {
    const source: Frame = {
      tables: [
        {
          id: 'm:0',
          title: 'SELECT',
          x: 500,
          y: 0,
          dashed: true,
          columns: [{ name: 'title', state: 'normal' }],
          rows: [{ key: 'src:0', values: ['Тихий Дон'], state: 'normal' }],
        },
      ],
      decorations: [],
    };
    const [phase] = dmlAnimator(
      source,
      stage({ inserted: [], defaulted: undefined, conflicts: [{ key: 'b=(0,1)', action: 'nothing' }] }),
      0,
      testCtx(),
    );
    expect(phase.frame.tables.map((table) => table.id)).toEqual(['m:0', 't:public.book']);
    expect(phase.frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'pair-line', from: expect.objectContaining({ table: 'm:0' }) }),
    );
  });

  it('VALUES ON CONFLICT показывает настоящую входящую строку до отскока', () => {
    const phases = dmlAnimator(
      { tables: [], decorations: [] },
      stage({
        inserted: [],
        defaulted: undefined,
        conflicts: [{ key: 'b=(0,1)', action: 'nothing' }],
        source: {
          columns: [{ name: 'title', type: 'text' }],
          rows: [{ key: 'src:0', lineage: {}, values: ['Тихий Дон'] }],
        },
      }),
      0,
      testCtx(),
    );
    expect(phases.map((phase) => phase.id)).toEqual(['0:conflict-source', '0:dml']);
    expect(phases[0].frame.tables.find((table) => table.id === 'i:0')?.rows[0].values).toEqual(['Тихий Дон']);
    expect(phases[1].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'pair-line', from: expect.objectContaining({ table: 'i:0' }) }),
    );
  });
});

const BOOK_KEYS = ['b=(0,1)', 'b=(0,2)', 'b=(0,3)', 'b=(0,7)', 'b=(0,8)'];
