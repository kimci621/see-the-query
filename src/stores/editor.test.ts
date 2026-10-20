import { beforeEach, describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { useEditorStore } from './editor';

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

describe('useEditorStore', () => {
  it('setText / setCursor / setParseError', () => {
    useEditorStore.getState().setText('select 1');
    useEditorStore.getState().setCursor(5);
    useEditorStore.getState().setParseError({ message: 'ой', position: 3 });
    const s = useEditorStore.getState();
    expect(s.text).toBe('select 1');
    expect(s.cursor).toBe(5);
    expect(s.parseError).toEqual({ message: 'ой', position: 3 });
    useEditorStore.getState().setParseError(null);
    expect(useEditorStore.getState().parseError).toBeNull();
  });

  it('insertQuery заменяет текст и ставит курсор в конец (кнопка «На доску»)', () => {
    useEditorStore.getState().setText('select 1');
    useEditorStore.getState().insertQuery('select * from book');
    const s = useEditorStore.getState();
    expect(s.text).toBe('select * from book');
    expect(s.cursor).toBe('select * from book'.length);
  });

  it('любая правка текста сбрасывает применённые операторы, тот же текст их держит (P8.50)', () => {
    useEditorStore.getState().setText('insert into t values (1)');
    useEditorStore.getState().markApplied(0, { sql: 'insert into t values (1)' } as Trace);
    useEditorStore.getState().setText('insert into t values (1)');
    expect(useEditorStore.getState().applied[0]?.sql).toBe('insert into t values (1)');
    useEditorStore.getState().setText('insert into t values (1) ');
    expect(useEditorStore.getState().applied).toEqual({});
    useEditorStore.getState().markApplied(0, { sql: 'x' } as Trace);
    useEditorStore.getState().insertQuery('select 1');
    expect(useEditorStore.getState().applied).toEqual({});
  });

  it('activeClause и hoveredColumn', () => {
    useEditorStore.getState().setActiveClause('where');
    useEditorStore.getState().setHoveredColumn('public.book.title');
    const s = useEditorStore.getState();
    expect(s.activeClause).toBe('where');
    expect(s.hoveredColumn).toBe('public.book.title');
  });
});
