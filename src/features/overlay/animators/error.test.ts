import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot } from '@/features/db/introspect';
import { testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { errorAnimator } from './error';

const column = (name: string) => ({
  name,
  type: 'text',
  nullable: true,
  default: null,
  isPk: false,
  isUnique: false,
  isGenerated: false,
  identity: null,
  checks: [],
  fk: null,
});
const schema: SchemaSnapshot = {
  schemas: ['public'],
  tables: [
    {
      id: 'public.book',
      schema: 'public',
      name: 'book',
      kind: 'table',
      columns: ['book_id', 'title', 'author_id'].map(column),
      rowCount: 11,
      sampleRows: [],
      sampleCtids: [],
      indexes: [],
      comment: null,
    },
  ],
  fks: [],
  sequences: [],
};
const ctx = { ...testCtx(), schema };
const MUST_APPEAR = 'column "book.title" must appear in the GROUP BY clause';
const errorStage = (code: string, columns: string[], message = MUST_APPEAR): StageOf<'error'> => ({
  id: '0:error',
  kind: 'error',
  error: { code, message } as StageOf<'error'>['error'],
  focus: { tableIds: ['public.book'], columns },
  caption: `Ошибка ${code}: column "book.title" must appear in the GROUP BY clause`,
  output: { columns: [], rows: [] },
});

describe('errorAnimator', () => {
  it('42803: таблица-призрак у ноды на доске, колонка вне GROUP BY перечёркнута', () => {
    const phases = errorAnimator(
      { tables: [], decorations: [] },
      errorStage('42803', ['public.book.title']),
      0,
      ctx,
    );
    expect(phases).toHaveLength(1);
    const t = phases[0].frame.tables.find((x) => x.id === 't:book');
    expect(t).toMatchObject({ x: 0, y: 0, rows: [] });
    expect(Object.fromEntries(t?.columns.map((c) => [c.name, c.state]) ?? [])).toEqual({
      book_id: 'normal',
      title: 'removed',
      author_id: 'normal',
    });
    expect(phases[0].caption).toContain('42803');
    expect(phases[0].caption).toContain('Колонка вне GROUP BY');
  });
  it('другие ошибки сцены не дают', () => {
    const phases = errorAnimator(
      { tables: [], decorations: [] },
      errorStage('42703', ['public.book.title']),
      0,
      ctx,
    );
    expect(phases).toEqual([]);
  });
  it('42803 без «must appear» (агрегат в WHERE) сцены не даёт', () => {
    const phases = errorAnimator(
      { tables: [], decorations: [] },
      errorStage(
        '42803',
        ['public.book.title', 'public.book.author_id'],
        'aggregate functions are not allowed in WHERE',
      ),
      0,
      ctx,
    );
    expect(phases).toEqual([]);
  });
});
