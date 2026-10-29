import { describe, expect, it } from 'vitest';
import { bookScan, testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
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
    const [phase] = dmlAnimator(
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
});
