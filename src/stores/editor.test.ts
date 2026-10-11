import { beforeEach, describe, expect, it } from 'vitest';
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

  it('activeClause и hoveredColumn', () => {
    useEditorStore.getState().setActiveClause('where');
    useEditorStore.getState().setHoveredColumn('public.book.title');
    const s = useEditorStore.getState();
    expect(s.activeClause).toBe('where');
    expect(s.hoveredColumn).toBe('public.book.title');
  });
});
