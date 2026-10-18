import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase, Playback } from '@/features/overlay/types';
import { useSceneStore } from '@/stores/scene';
import { usePlayer } from './usePlayer';

const pb = (n: number, ms = 500): Playback => ({
  phases: Array.from(
    { length: n },
    (_, i): Phase => ({
      id: `p${i}`,
      stageIndex: 0,
      caption: '',
      durationMs: ms,
      frame: { tables: [], decorations: [] },
    }),
  ),
  stageStarts: [0],
});

describe('usePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSceneStore.setState(useSceneStore.getInitialState(), true);
  });
  afterEach(() => vi.useRealTimers());

  it('автоплей идёт на 2x (с общим замедлением фаза 500 мс длится 500 мс) и останавливается на последней фазе', () => {
    renderHook(() => usePlayer());
    act(() => useSceneStore.getState().setPlayback(pb(3)));
    act(() => vi.advanceTimersByTime(500));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    act(() => vi.advanceTimersByTime(500));
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    act(() => vi.advanceTimersByTime(500));
    expect(useSceneStore.getState().playing).toBe(false);
  });

  it('обычное проигрывание учитывает скорость 0.5x', () => {
    renderHook(() => usePlayer());
    act(() => {
      useSceneStore.getState().setAutoplay(false);
      useSceneStore.getState().setSpeed(0.5);
      useSceneStore.getState().setPlayback(pb(3));
      useSceneStore.getState().seek(0);
      useSceneStore.getState().play();
    });
    act(() => vi.advanceTimersByTime(1999));
    expect(useSceneStore.getState().phaseIndex).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
  });

  it('смена playback перезапускает таймер', () => {
    renderHook(() => usePlayer());
    act(() => useSceneStore.getState().setPlayback(pb(5)));
    act(() => vi.advanceTimersByTime(400));
    act(() => useSceneStore.getState().setPlayback(pb(2, 1000)));
    act(() => vi.advanceTimersByTime(900));
    expect(useSceneStore.getState().phaseIndex).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(useSceneStore.getState().phaseIndex).toBe(1);
  });
});
