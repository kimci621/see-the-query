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
      <button type="button" data-testid="inner-button">
        Миникарта
      </button>
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
    // Esc прячет сцену: итог запроса и проигрывание остаются, плеер снова оживает
    expect(useSceneStore.getState().hidden).toBe(true);
    expect(useSceneStore.getState().trace).not.toBeNull();
    fireEvent.keyDown(board, { key: 'ArrowLeft' });
    expect(useSceneStore.getState().hidden).toBe(false);
  });

  it('автоповтор пробела (зажат для пана) и пробел на кнопке внутри доски плеер не трогают', () => {
    render(<Board />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: ' ', repeat: true });
    expect(useSceneStore.getState().playing).toBe(false);
    fireEvent.keyDown(screen.getByTestId('inner-button'), { key: ' ' });
    expect(useSceneStore.getState().playing).toBe(false);
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
