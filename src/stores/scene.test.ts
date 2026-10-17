import { beforeEach, describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { useSceneStore } from './scene';

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

  it('плеерные методы меняют состояние (используются с Ф6)', () => {
    useSceneStore.getState().play();
    expect(useSceneStore.getState().playing).toBe(true);
    useSceneStore.getState().pause();
    expect(useSceneStore.getState().playing).toBe(false);
    useSceneStore.getState().seek(3);
    expect(useSceneStore.getState().phaseIndex).toBe(3);
    useSceneStore.getState().step(-1);
    expect(useSceneStore.getState().phaseIndex).toBe(2);
    useSceneStore.getState().step(1);
    expect(useSceneStore.getState().phaseIndex).toBe(3);
  });
});
