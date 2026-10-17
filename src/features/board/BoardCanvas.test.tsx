import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Controls, ReactFlowInstance, useStoreApi } from '@xyflow/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardStore } from '@/stores/board';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';
import { SCHEMA } from './__fixtures__/schema';
import { BoardCanvas } from './BoardCanvas';

// Достаём экземпляр React Flow из useReactFlow, чтобы двигать камеру и шпионить за fitView
const holder: {
  flow: ReactFlowInstance | null;
  store: ReturnType<typeof useStoreApi> | null;
  controlsProps: ComponentProps<typeof Controls> | null;
} = {
  flow: null,
  store: null,
  controlsProps: null,
};
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    // Кнопка «Вписать доску» зовёт fitView из своего экземпляра useReactFlow, шпион до него не достаёт:
    // проверяем кадр, который доска отдала Controls
    Controls: (props: ComponentProps<typeof Controls>) => {
      holder.controlsProps = props;
      return <actual.Controls {...props} />;
    },
    useReactFlow: () => {
      const flow = actual.useReactFlow();
      holder.store = actual.useStoreApi();
      if (holder.flow !== flow) {
        holder.flow = flow;
        vi.spyOn(flow, 'fitView');
      }
      return flow;
    },
  };
});

// Кадры оставляют снизу пустую полосу хрома доски (кнопки зума, плашка версии): 3.5rem при шрифте 16px
const FOCUS_PAD = { x: 0.1, top: 0.1, bottom: '56px' };
const BOARD_PAD = { x: 0.15, top: 0.15, bottom: '56px' };

function mockReducedMotion(reduced: boolean) {
  const real = window.matchMedia;
  return vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...real(query),
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
  }));
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/l/unknown']}>
      <Routes>
        <Route path="/l/:lessonId" element={<BoardCanvas />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Замер ноды: в jsdom React Flow ноды не меряет. Ставим ширину во внутреннюю ноду и будим подписчиков стора
function measure(id: string, width: number) {
  act(() => {
    const store = holder.store;
    const node = store?.getState().nodeLookup.get(id);
    if (!store || !node) throw new Error(`нет ноды ${id}`);
    node.measured = { width, height: 300 };
    store.setState({});
  });
}

function flow(): ReactFlowInstance {
  if (!holder.flow) throw new Error('React Flow ещё не смонтирован');
  return holder.flow;
}

describe('BoardCanvas', () => {
  beforeEach(() => {
    holder.flow = null;
    holder.store = null;
    holder.controlsProps = null;
    useBoardStore.setState(useBoardStore.getInitialState(), true);
    useBoardStore.getState().setSchema(SCHEMA);
    useLessonStore.setState({ byId: {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('при малом зуме доска получает data-far', async () => {
    renderBoard();
    const board = screen.getByTestId('board-canvas');
    await act(() => flow().setViewport({ x: 0, y: 0, zoom: 0.4 }));
    expect(board).toHaveAttribute('data-far');
    await act(() => flow().setViewport({ x: 0, y: 0, zoom: 1 }));
    expect(board).not.toHaveAttribute('data-far');
  });

  it('⌘0 не перехватывается вне доски', () => {
    renderBoard();
    const before = useBoardStore.getState().fitRequest;
    const outside = new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, cancelable: true });
    window.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(useBoardStore.getState().fitRequest).toBe(before);

    fireEvent.pointerEnter(screen.getByTestId('board-canvas'));
    const over = new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, cancelable: true });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(useBoardStore.getState().fitRequest).toBe(before + 1);

    fireEvent.pointerLeave(screen.getByTestId('board-canvas'));
    const left = new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, cancelable: true });
    window.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
  });

  it('⌘0 работает, когда фокус внутри доски', () => {
    renderBoard();
    const board = screen.getByTestId('board-canvas');
    const button = board.querySelector('button');
    button?.focus();
    const e = new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('fitView уважает reduced motion и minZoom', () => {
    mockReducedMotion(true);
    renderBoard();
    act(() => useBoardStore.getState().requestFit());
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 0, minZoom: 0.6, padding: BOARD_PAD }),
    );
  });

  it('без reduced motion автоподгонка анимируется', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().requestFit());
    expect(flow().fitView).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 300, minZoom: 0.6 }));
  });

  it('кнопка «Вписать доску» вписывает тем же кадром, что и ⌘0', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().requestFit());
    const hotkey = vi.mocked(flow().fitView).mock.lastCall?.[0];
    expect(holder.controlsProps?.fitViewOptions).toEqual(hotkey);
  });

  it('кадр берёт только таблицы, без рамок схем', () => {
    renderBoard();
    act(() => useBoardStore.getState().requestFit());
    const ids = vi.mocked(flow().fitView).mock.lastCall?.[0]?.nodes?.map((n) => n.id);
    expect(ids).toHaveLength(SCHEMA.tables.length);
    expect(ids).toEqual(expect.arrayContaining(SCHEMA.tables.map((t) => t.id)));
  });

  it('смена режима фокуса вписывает доску после новой ширины контейнера', () => {
    mockReducedMotion(false);
    renderBoard();
    vi.mocked(flow().fitView).mockClear();
    act(() => useSettingsStore.getState().toggleFocusMode());
    expect(flow().fitView).not.toHaveBeenCalled();
    act(() => holder.store?.setState({ width: 900 }));
    expect(flow().fitView).toHaveBeenCalledTimes(1);
    expect(flow().fitView).toHaveBeenCalledWith(
      expect.objectContaining({ padding: BOARD_PAD, minZoom: 0.6, duration: 300 }),
    );
    // Дальнейшие смены ширины без режима фокуса камеру не трогают
    act(() => holder.store?.setState({ width: 800 }));
    expect(flow().fitView).toHaveBeenCalledTimes(1);
  });

  it('режим фокуса при таблицах запроса вписывает их крупно, а не всю доску', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().frameStart(['public.book']));
    act(() => useSettingsStore.getState().toggleFocusMode());
    act(() => holder.store?.setState({ width: 1400 }));
    expect(vi.mocked(flow().fitView).mock.lastCall?.[0]?.nodes?.map((n) => n.id)).toEqual(['public.book']);
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ padding: FOCUS_PAD, maxZoom: 1, duration: 400 }),
    );
  });

  const fitNodes = () => vi.mocked(flow().fitView).mock.lastCall?.[0]?.nodes?.map((n) => n.id);

  it('стартовый кадр урока: таблицы стартового запроса, крупно и без полёта', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().frameStart(['public.book']));
    expect(fitNodes()).toEqual(['public.book']);
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ padding: FOCUS_PAD, minZoom: 0.6, maxZoom: 1, duration: 0 }),
    );
  });

  it('стартовый кадр без таблиц запроса вписывает всю доску', () => {
    renderBoard();
    act(() => useBoardStore.getState().frameStart([]));
    expect(fitNodes()).toHaveLength(SCHEMA.tables.length);
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ padding: BOARD_PAD, duration: 0 }),
    );
  });

  it('таблиц стартового запроса нет на доске: вписывается вся доска', () => {
    renderBoard();
    act(() => useBoardStore.getState().frameStart(['public.nope']));
    expect(fitNodes()).toHaveLength(SCHEMA.tables.length);
  });

  it('замер свёртки старта (select * развернул book) ставит кадр без полёта, следующий разворот летит', () => {
    mockReducedMotion(false);
    renderBoard();
    measure('public.book', 756);
    act(() => {
      useBoardStore.getState().expandTables(['public.book']);
      useBoardStore.getState().frameStart(['public.book']);
    });
    measure('public.book', 1188);
    expect(fitNodes()).toEqual(['public.book']);
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ padding: FOCUS_PAD, duration: 0 }),
    );

    act(() => useBoardStore.getState().expandTables([]));
    measure('public.book', 756);
    expect(flow().fitView).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 400 }));
  });

  it('сохранённая камера урока важнее стартового кадра', async () => {
    const saved = { x: 12, y: 34, zoom: 1.5 };
    useLessonStore.getState().setViewport('unknown', saved);
    renderBoard();
    act(() => useBoardStore.getState().frameStart(['public.book']));
    expect(flow().fitView).not.toHaveBeenCalled();
    await act(async () => undefined);
    expect(flow().getViewport()).toEqual(saved);
  });

  it('⌘0 после стартового кадра вписывает все таблицы, фокус анимируется', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().frameStart(['public.book']));
    act(() => useBoardStore.getState().requestFit());
    expect(fitNodes()).toHaveLength(SCHEMA.tables.length);
    act(() => useBoardStore.getState().focus(['public.author']));
    expect(fitNodes()).toEqual(['public.author']);
    expect(flow().fitView).toHaveBeenLastCalledWith(
      expect.objectContaining({ padding: FOCUS_PAD, maxZoom: 1, duration: 400 }),
    );
  });
});
