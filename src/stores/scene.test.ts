import { beforeEach, describe, expect, it } from 'vitest';
import type { Phase, Playback } from '@/features/overlay/types';
import type { Trace } from '@/features/tracer/types';
import { effectiveSpeed, useSceneStore } from './scene';

const frame = { tables: [], decorations: [] };
const phase = (i: number): Phase => ({
  id: `p${i}`,
  stageIndex: 0,
  caption: `фаза ${i}`,
  durationMs: 500,
  frame,
});
const playback = (n: number): Playback => ({
  phases: Array.from({ length: n }, (_, i) => phase(i)),
  stageStarts: [0],
});

const trace = (sql: string): Trace => ({
  sql,
  statementType: 'select',
  mode: 'final-only',
  touched: { tableIds: ['public.book'], columns: [], expanded: [] },
  stages: [],
  result: null,
  error: null,
  notices: [],
  timingMs: 5,
});

beforeEach(() => {
  useSceneStore.setState({ ...useSceneStore.getInitialState(), generation: 0 }, true);
  localStorage.removeItem('vs-scene');
});

describe('useSceneStore', () => {
  it('nextGeneration инкрементирует и возвращает номер', () => {
    expect(useSceneStore.getState().nextGeneration()).toBe(1);
    expect(useSceneStore.getState().nextGeneration()).toBe(2);
    expect(useSceneStore.getState().generation).toBe(2);
  });

  it('setTrace отбрасывает устаревшее поколение и сбрасывает stale', () => {
    useSceneStore.getState().nextGeneration(); // 1
    const g2 = useSceneStore.getState().nextGeneration(); // 2
    useSceneStore.getState().setStale(true);
    useSceneStore.getState().setTrace(trace('select 1'), 1); // устаревшее
    expect(useSceneStore.getState().trace).toBeNull();
    useSceneStore.getState().setTrace(trace('select 2'), g2);
    const s = useSceneStore.getState();
    expect(s.trace?.sql).toBe('select 2');
    expect(s.status).toBe('ready');
    expect(s.stale).toBe(false);
  });

  it('close возвращает в idle', () => {
    const g = useSceneStore.getState().nextGeneration();
    useSceneStore.getState().setTrace(trace('select 1'), g);
    useSceneStore.getState().close();
    expect(useSceneStore.getState().trace).toBeNull();
    expect(useSceneStore.getState().status).toBe('idle');
  });

  it('persist сохраняет только speed / autoplay / followCamera', () => {
    useSceneStore.getState().setSpeed(2);
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setFollowCamera(false);
    const g = useSceneStore.getState().nextGeneration();
    useSceneStore.getState().setTrace(trace('select 1'), g);
    const saved = JSON.parse(localStorage.getItem('vs-scene') ?? '{}').state;
    expect(saved).toEqual({ speed: 2, autoplay: false, followCamera: false });
    expect(saved.trace).toBeUndefined();
  });

  it('setTrace не трогает проигрывание: новое придёт через setPlayback', () => {
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().setTrace(trace('select 1'), useSceneStore.getState().nextGeneration());
    expect(useSceneStore.getState().playback?.phases).toHaveLength(3);
  });

  it('setPlayback сбрасывает индекс и запускает автоплей заново', () => {
    const s = useSceneStore.getState();
    s.setAutoplay(true);
    s.setPlayback(playback(5));
    s.advance();
    s.advance();
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    useSceneStore.getState().setPlayback(playback(2));
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(0);
    expect(st.playing).toBe(true);
    expect(st.autoRun).toBe(true);
    expect(st.instant).toBe(true);
  });

  it('без автоплея setPlayback сразу показывает последнюю фазу', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(4));
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(3);
    expect(st.playing).toBe(false);
  });

  it('advance на последней фазе останавливает плеер и снимает autoRun', () => {
    useSceneStore.getState().setAutoplay(true);
    useSceneStore.getState().setPlayback(playback(2));
    useSceneStore.getState().advance();
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    useSceneStore.getState().advance();
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(1);
    expect(st.playing).toBe(false);
    expect(st.autoRun).toBe(false);
  });

  it('seek мгновенный, ставит паузу и ограничивает индекс', () => {
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().play();
    useSceneStore.getState().seek(10);
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(2);
    expect(st.instant).toBe(true);
    expect(st.playing).toBe(false);
  });

  it('step назад мгновенный, вперёд анимированный', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().step(-1);
    expect(useSceneStore.getState().phaseIndex).toBe(1);
    expect(useSceneStore.getState().instant).toBe(true);
    useSceneStore.getState().step(1);
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    expect(useSceneStore.getState().instant).toBe(false);
  });

  it('play на последней фазе начинает с начала', () => {
    useSceneStore.getState().setAutoplay(false);
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().play();
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(0);
    expect(st.playing).toBe(true);
  });

  it('effectiveSpeed при autoRun не меньше 2', () => {
    useSceneStore.getState().setSpeed(0.5);
    useSceneStore.getState().setAutoplay(true);
    useSceneStore.getState().setPlayback(playback(3));
    expect(effectiveSpeed(useSceneStore.getState())).toBe(2);
    useSceneStore.getState().pause();
    expect(effectiveSpeed(useSceneStore.getState())).toBe(0.5);
  });

  it('close очищает сцену и проигрывание', () => {
    useSceneStore.getState().setTrace(trace('select 1'), useSceneStore.getState().nextGeneration());
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().close();
    const st = useSceneStore.getState();
    expect(st.trace).toBeNull();
    expect(st.playback).toBeNull();
    expect(st.playing).toBe(false);
    expect(st.status).toBe('idle');
  });

  it('hide прячет сцену, но трасса и проигрывание остаются; play и seek возвращают', () => {
    const s = useSceneStore.getState();
    s.setTrace(trace('select 1'), s.nextGeneration());
    useSceneStore.getState().setPlayback(playback(3));
    useSceneStore.getState().hide();
    let st = useSceneStore.getState();
    expect(st.hidden).toBe(true);
    expect(st.playing).toBe(false);
    expect(st.trace).not.toBeNull();
    expect(st.playback?.phases).toHaveLength(3);
    st.play();
    expect(useSceneStore.getState().hidden).toBe(false);
    st.hide();
    st.seek(1);
    st = useSceneStore.getState();
    expect(st.hidden).toBe(false);
    expect(st.phaseIndex).toBe(1);
  });
});
