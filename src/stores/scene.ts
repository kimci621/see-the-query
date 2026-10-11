import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Trace } from '@/features/tracer/types';

export interface SceneStore {
  trace: Trace | null;
  generation: number;
  status: 'idle' | 'tracing' | 'ready' | 'error';
  stale: boolean; // ввод невалиден, сцена погашена
  phaseIndex: number;
  playing: boolean;
  speed: 0.5 | 1 | 2;
  autoplay: boolean;
  followCamera: boolean;
  nextGeneration(): number;
  setTrace(trace: Trace, generation: number): void; // игнорирует устаревшее поколение
  setStatus(s: SceneStore['status']): void;
  setStale(v: boolean): void;
  seek(phaseIndex: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  step(delta: 1 | -1): void;
  setSpeed(s: 0.5 | 1 | 2): void;
  setAutoplay(v: boolean): void;
  setFollowCamera(v: boolean): void;
  close(): void;
}

export const useSceneStore = create<SceneStore>()(
  persist(
    (set, get) => ({
      trace: null,
      generation: 0,
      status: 'idle',
      stale: false,
      phaseIndex: 0,
      playing: false,
      speed: 1,
      autoplay: true,
      followCamera: true,
      nextGeneration: () => {
        const generation = get().generation + 1;
        set({ generation, status: 'tracing' });
        return generation;
      },
      setTrace: (trace, generation) => {
        if (generation < get().generation) return;
        set({ trace, generation, status: 'ready', stale: false, phaseIndex: 0, playing: false });
      },
      setStatus: (status) => set({ status }),
      setStale: (stale) => set({ stale }),
      seek: (phaseIndex) => set({ phaseIndex, playing: false }),
      play: () => set({ playing: true }),
      pause: () => set({ playing: false }),
      toggle: () => set({ playing: !get().playing }),
      step: (delta) => set({ phaseIndex: Math.max(0, get().phaseIndex + delta), playing: false }),
      setSpeed: (speed) => set({ speed }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setFollowCamera: (followCamera) => set({ followCamera }),
      close: () => set({ trace: null, status: 'idle', stale: false, phaseIndex: 0, playing: false }),
    }),
    {
      name: 'vs-scene',
      partialize: (s) => ({ speed: s.speed, autoplay: s.autoplay, followCamera: s.followCamera }),
    },
  ),
);
