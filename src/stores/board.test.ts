import { beforeEach, describe, expect, it } from 'vitest';
import { useBoardStore } from './board';

describe('useBoardStore', () => {
  beforeEach(() => useBoardStore.setState(useBoardStore.getInitialState(), true));

  it('focus меняет набор и просит камеру', () => {
    useBoardStore.getState().focus(['public.book']);
    expect(useBoardStore.getState().focused).toEqual(['public.book']);
    expect(useBoardStore.getState().focusRequest).toBe(1);
  });

  it('тот же набор в другом порядке камеру не дёргает', () => {
    const { focus } = useBoardStore.getState();
    focus(['public.book', 'public.author']);
    const before = useBoardStore.getState();
    focus(['public.author', 'public.book']);
    expect(useBoardStore.getState()).toBe(before);
    expect(useBoardStore.getState().focusRequest).toBe(1);
  });

  it('frameStart ставит набор и просит стартовый кадр, даже если набор не изменился', () => {
    const s = useBoardStore.getState();
    s.focus(['public.book']);
    s.frameStart(['public.book']);
    expect(useBoardStore.getState()).toMatchObject({
      focused: ['public.book'],
      startRequest: 1,
      focusRequest: 1,
    });
    s.frameStart([]);
    expect(useBoardStore.getState()).toMatchObject({ focused: [], startRequest: 2, focusRequest: 1 });
  });

  it('retarget меняет цель рефита, но не рамку и не камеру; focus того же набора возвращает цель', () => {
    const s = useBoardStore.getState();
    s.focus(['public.author']);
    s.retarget(['public.book']);
    expect(useBoardStore.getState()).toMatchObject({
      focused: ['public.author'],
      frameTarget: ['public.book'],
      focusRequest: 1,
    });
    s.focus(['public.author']);
    expect(useBoardStore.getState()).toMatchObject({ frameTarget: ['public.author'], focusRequest: 1 });
  });

  it('highlightColumns с тем же списком не меняет состояние', () => {
    useBoardStore.getState().highlightColumns(['public.book.title']);
    const before = useBoardStore.getState();
    useBoardStore.getState().highlightColumns(['public.book.title']);
    expect(useBoardStore.getState()).toBe(before);
    useBoardStore.getState().highlightColumns([]);
    expect(useBoardStore.getState().highlightedColumns).toEqual([]);
  });

  it('expandTables с тем же набором не меняет состояние', () => {
    useBoardStore.getState().expandTables(['public.book', 'public.author']);
    const before = useBoardStore.getState();
    useBoardStore.getState().expandTables(['public.author', 'public.book']);
    expect(useBoardStore.getState()).toBe(before);
    useBoardStore.getState().expandTables([]);
    expect(useBoardStore.getState().expandedTables).toEqual([]);
  });

  it('setQueryColumns с тем же списком не меняет состояние', () => {
    useBoardStore.getState().setQueryColumns(['public.book.tags']);
    const before = useBoardStore.getState();
    useBoardStore.getState().setQueryColumns(['public.book.tags']);
    expect(useBoardStore.getState()).toBe(before);
  });

  it('requestFit увеличивает счётчик, setDimmed и setVisibleTables пишут поля', () => {
    const s = useBoardStore.getState();
    s.requestFit();
    s.requestFit();
    s.setDimmed(true);
    s.setVisibleTables(['public.book']);
    expect(useBoardStore.getState()).toMatchObject({
      fitRequest: 2,
      dimmed: true,
      visibleTables: ['public.book'],
    });
  });
});
