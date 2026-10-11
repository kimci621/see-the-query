import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace } from '@/features/overlay/__fixtures__/traces';
import type { Playback } from '@/features/overlay/types';
import { useSceneStore } from '@/stores/scene';
import { useBoardHotkeys } from './useBoardHotkeys';

function Board() {
  const ref = useRef<HTMLDivElement>(null);
  useBoardHotkeys(ref);
  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: как на настоящей доске, фокус ради клавиш плеера
      tabIndex={0}
      data-testid="board"
    >
      <input data-testid="field" />
    </div>
  );
}

const pb: Playback = {
  phases: [0, 1, 2].map((i) => ({
    id: `p${i}`,
    stageIndex: 0,
    caption: '',
    durationMs: 500,
    frame: { tables: [], decorations: [] },
  })),
  stageStarts: [0],
};

describe('useBoardHotkeys', () => {
  beforeEach(() => {
    useSceneStore.setState(useSceneStore.getInitialState(), true);
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setTrace(fullPipelineTrace(), useSceneStore.getState().nextGeneration());
    useSceneStore.getState().setPlayback(pb);
  });

  it('стрелки шагают, пробел играет, Esc закрывает', () => {
    render(<Board />);
    const board = screen.getByTestId('board');
    fireEvent.keyDown(board, { key: 'ArrowLeft' });
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    fireEvent.keyDown(board, { key: ' ' });
    expect(useSceneStore.getState().playing).toBe(true);
    fireEvent.keyDown(board, { key: 'Escape' });
    expect(useSceneStore.getState().playback).toBeNull();
    // Закрывается только сцена: итог запроса остаётся в панели результата
    expect(useSceneStore.getState().trace).not.toBeNull();
  });

  it('пробел в поле ввода не трогает плеер', () => {
    render(<Board />);
    fireEvent.keyDown(screen.getByTestId('field'), { key: ' ' });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'ArrowLeft' });
    const st = useSceneStore.getState();
    expect(st.playing).toBe(false);
    expect(st.phaseIndex).toBe(2);
  });
});
