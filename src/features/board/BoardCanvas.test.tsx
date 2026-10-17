import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactFlowInstance } from '@xyflow/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardStore } from '@/stores/board';
import { useSettingsStore } from '@/stores/settings';
import { SCHEMA } from './__fixtures__/schema';
import { BoardCanvas } from './BoardCanvas';

// Достаём экземпляр React Flow из useReactFlow, чтобы двигать камеру и шпионить за fitView
const holder: { flow: ReactFlowInstance | null } = { flow: null };
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => {
      const flow = actual.useReactFlow();
      if (holder.flow !== flow) {
        holder.flow = flow;
        vi.spyOn(flow, 'fitView');
      }
      return flow;
    },
  };
});

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

function flow(): ReactFlowInstance {
  if (!holder.flow) throw new Error('React Flow ещё не смонтирован');
  return holder.flow;
}

describe('BoardCanvas', () => {
  beforeEach(() => {
    holder.flow = null;
    useBoardStore.setState(useBoardStore.getInitialState(), true);
    useBoardStore.getState().setSchema(SCHEMA);
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
      expect.objectContaining({ duration: 0, minZoom: 0.6, padding: 0.15 }),
    );
  });

  it('без reduced motion автоподгонка анимируется', () => {
    mockReducedMotion(false);
    renderBoard();
    act(() => useBoardStore.getState().requestFit());
    expect(flow().fitView).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 300, minZoom: 0.6 }));
  });

  it('смена режима фокуса пересобирает камеру', () => {
    mockReducedMotion(false);
    renderBoard();
    vi.mocked(flow().fitView).mockClear();
    act(() => useSettingsStore.getState().toggleFocusMode());
    expect(flow().fitView).toHaveBeenCalledWith(
      expect.objectContaining({ padding: 0.15, minZoom: 0.6, duration: 300 }),
    );
  });
});
