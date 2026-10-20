import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { OverlayLayer } from './OverlayLayer';
import type { Playback } from './types';

// React Flow не нужен: таймер возврата камеры живёт в сторах. Объекты стабильные, как у React Flow
vi.mock('@xyflow/react', () => {
  const flow = { setViewport: vi.fn(), getNodes: () => [] };
  const store = { getState: () => ({ width: 800, height: 600, minZoom: 0.1, maxZoom: 2 }) };
  return {
    useReactFlow: () => flow,
    useStoreApi: () => store,
    getViewportForBounds: () => ({ x: 0, y: 0, zoom: 1 }),
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
  };
});
const PLAYBACK: Playback = {
  phases: [
    {
      id: '0:scan',
      stageIndex: 0,
      caption: '',
      durationMs: 100,
      frame: { tables: [], decorations: [], camera: { x: 0, y: 0, width: 100, height: 100 } },
    },
  ],
  stageStarts: [0],
};
vi.mock('./playback', () => ({ buildPlayback: () => PLAYBACK }));

describe('OverlayLayer: возврат камеры после ухода сцены', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Сцену ведёт пользователь: запрос в редакторе положила кнопка урока
    useEditorStore.setState({ text: 'select 1' });
    useSceneStore.setState({ lessonQuery: 'select 1', followCamera: true, autoplay: false });
    useBoardStore.setState({ schema: {} as SchemaSnapshot, frameRequest: 0 });
    render(<OverlayLayer />);
    act(() => useSceneStore.setState({ trace: { touched: { columns: [] } } as unknown as Trace }));
    // сцена ушла (Esc): через паузу камера должна вернуться к таблицам
    act(() => useSceneStore.getState().hide());
  });
  afterEach(() => {
    vi.useRealTimers();
    useSceneStore.setState({ trace: null, playback: null, hidden: false, lessonQuery: null });
  });

  it('без других действий камера возвращается через паузу', () => {
    act(() => vi.advanceTimersByTime(1000));
    expect(useBoardStore.getState().frameRequest).toBe(1);
  });

  it('⌘0 за время паузы: камера остаётся на вписанной доске', () => {
    act(() => useBoardStore.getState().requestFit());
    act(() => vi.advanceTimersByTime(1000));
    expect(useBoardStore.getState().frameRequest).toBe(0);
  });

  it('переход в урок за время паузы: стартовый кадр урока не перебивается', () => {
    act(() => {
      useSceneStore.getState().setLessonQuery(null);
      useBoardStore.getState().frameStart([]);
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(useBoardStore.getState().frameRequest).toBe(0);
  });
});

describe('OverlayLayer: сцена стартового запроса урока', () => {
  afterEach(() => {
    useSceneStore.setState({
      trace: null,
      playback: null,
      hidden: false,
      lessonQuery: null,
      startQuery: null,
    });
    document.body.innerHTML = '';
  });

  it('фокус на доске раньше трассы: сцена спрятана (P8.111)', () => {
    const board = document.createElement('div');
    board.dataset.testid = 'board-area';
    board.tabIndex = 0;
    document.body.append(board);
    board.focus();
    useEditorStore.setState({ text: 'select 1' });
    useSceneStore.setState({ startQuery: 'select 1', lessonQuery: null, hidden: false, autoplay: false });
    useBoardStore.setState({ schema: {} as SchemaSnapshot });
    render(<OverlayLayer />);
    act(() => useSceneStore.setState({ trace: { touched: { columns: [] } } as unknown as Trace }));
    expect(useSceneStore.getState().hidden).toBe(true);
  });
});
