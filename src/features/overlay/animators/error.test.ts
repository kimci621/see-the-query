import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot } from '@/features/db/introspect';
import { runUpTo } from '../__fixtures__/runUpTo';
import { groupTrace, testCtx } from '../__fixtures__/traces';
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
      title: 'error',
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

describe('errorAnimator: 42803 в стопке группы', () => {
  const trace = groupTrace();
  const group = trace.stages[1] as StageOf<'group'>;
  const stage = {
    ...errorStage('42803', ['public.book.title'], 'column "b.title" must appear in the GROUP BY clause'),
    group: { keys: group.keys, keyColumns: group.keyColumns, groups: group.groups },
  };
  const phases = errorAnimator(runUpTo(trace, 1, ctx), stage, 1, ctx);
  const last = phases[phases.length - 1];

  it('строки съезжаются в стопки групп, затем фаза ошибки', () => {
    expect(phases.map((p) => p.id)).toEqual(['1:color', '1:stack', '1:error']);
    expect(last.frame.decorations.filter((d) => d.kind === 'bracket')).toHaveLength(3);
  });
  it('колонка вне GROUP BY красная, ключ подсвечен, подпись объясняет', () => {
    const t = last.frame.tables[0];
    expect(Object.fromEntries(t.columns.map((c) => [c.name, c.state]))).toEqual({
      book_id: 'normal',
      title: 'error',
      author_id: 'key',
    });
    expect(last.caption).toContain('Колонка вне GROUP BY');
    expect(last.caption).toContain('title');
  });
  it('ключ выражением подсвечен по номеру колонки: group by lower(title)', () => {
    const byExpr = {
      ...errorStage(
        '42803',
        ['public.book.book_id'],
        'column "b.book_id" must appear in the GROUP BY clause',
      ),
      group: { keys: ['lower(title)'], keyColumns: [1], groups: group.groups },
    };
    const p = errorAnimator(runUpTo(trace, 1, ctx), byExpr, 1, ctx);
    const cols = p[p.length - 1].frame.tables[0].columns;
    expect(Object.fromEntries(cols.map((c) => [c.name, c.state]))).toEqual({
      book_id: 'error',
      title: 'key',
      author_id: 'normal',
    });
  });
});
