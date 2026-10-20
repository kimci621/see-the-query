import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Playback } from '@/features/overlay/types';
import type { Trace } from '@/features/tracer/types';

export interface SceneStore {
  trace: Trace | null;
  generation: number;
  status: 'idle' | 'tracing' | 'ready' | 'error';
  stale: boolean; // ввод невалиден, сцена погашена
  playback: Playback | null;
  hidden: boolean; // сцена спрятана (Esc, сбой рендера): трасса и проигрывание остаются, плеер её вернёт
  phaseIndex: number;
  playing: boolean;
  instant: boolean; // следующий кадр без анимации: скраб, шаг назад, новая сцена
  autoRun: boolean; // автопроигрывание после правки запроса, не медленнее 2x
  speed: 0.5 | 1 | 2;
  autoplay: boolean;
  followCamera: boolean;
  // Запрос, который кнопка урока («На доску», шаг сцены, «Применить») положила в редактор.
  // Пока текст редактора тот же, сцену запустил пользователь, где бы ни был фокус. Открытие урока сбрасывает
  lessonQuery: string | null;
  // Стартовый текст открытого урока. Пока он в редакторе, его сцену запустил не пользователь,
  // даже если фокус уже на доске (P8.111)
  startQuery: string | null;
  nextGeneration(): number;
  setTrace(trace: Trace, generation: number): void; // игнорирует устаревшее поколение
  setStatus(s: SceneStore['status']): void;
  setStale(v: boolean): void;
  setPlayback(p: Playback | null): void;
  hide(): void;
  seek(phaseIndex: number): void;
  advance(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  step(delta: 1 | -1): void;
  setSpeed(s: 0.5 | 1 | 2): void;
  setAutoplay(v: boolean): void;
  setFollowCamera(v: boolean): void;
  setLessonQuery(sql: string | null): void;
  setStartQuery(sql: string | null): void;
  close(): void;
}

const lastIndex = (p: Playback | null) => (p ? Math.max(0, p.phases.length - 1) : 0);

export const useSceneStore = create<SceneStore>()(
  persist(
    (set, get) => ({
      trace: null,
      generation: 0,
      status: 'idle',
      stale: false,
      playback: null,
      hidden: false,
      phaseIndex: 0,
      playing: false,
      instant: true,
      autoRun: false,
      speed: 1,
      autoplay: true,
      followCamera: true,
      lessonQuery: null,
      startQuery: null,
      nextGeneration: () => {
        const generation = get().generation + 1;
        set({ generation, status: 'tracing' });
        return generation;
      },
      setTrace: (trace, generation) => {
        if (generation < get().generation) return;
        // Проигрывание не трогаем: новое придёт через setPlayback, оверлей не мигает
        set({ trace, generation, status: 'ready', stale: false });
      },
      setStatus: (status) => set({ status }),
      setStale: (stale) => set({ stale }),
      setPlayback: (playback) => {
        if (!playback || playback.phases.length === 0)
          set({ playback, hidden: false, phaseIndex: 0, playing: false, autoRun: false, instant: true });
        else if (get().autoplay)
          set({ playback, hidden: false, phaseIndex: 0, playing: true, autoRun: true, instant: true });
        else
          set({
            playback,
            hidden: false,
            phaseIndex: lastIndex(playback),
            playing: false,
            autoRun: false,
            instant: true,
          });
      },
      hide: () => set({ hidden: true, playing: false, autoRun: false }),
      seek: (index) =>
        set({
          phaseIndex: Math.min(Math.max(0, index), lastIndex(get().playback)),
          hidden: false,
          instant: true,
          playing: false,
          autoRun: false,
        }),
      advance: () => {
        const { phaseIndex, playback } = get();
        if (phaseIndex < lastIndex(playback)) set({ phaseIndex: phaseIndex + 1, instant: false });
        else set({ playing: false, autoRun: false });
      },
      play: () => {
        const { phaseIndex, playback } = get();
        if (!playback || playback.phases.length === 0) return;
        // С последней фазы играем сначала
        if (phaseIndex >= lastIndex(playback))
          set({ phaseIndex: 0, hidden: false, instant: true, playing: true, autoRun: false });
        else set({ hidden: false, playing: true, autoRun: false });
      },
      pause: () => set({ playing: false, autoRun: false }),
      toggle: () => (get().playing ? get().pause() : get().play()),
      // Назад показываем мгновенно, вперёд анимируем
      step: (delta) =>
        set({
          phaseIndex: Math.min(Math.max(0, get().phaseIndex + delta), lastIndex(get().playback)),
          hidden: false,
          instant: delta < 0,
          playing: false,
          autoRun: false,
        }),
      setSpeed: (speed) => set({ speed }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setFollowCamera: (followCamera) => set({ followCamera }),
      setLessonQuery: (lessonQuery) => set({ lessonQuery }),
      setStartQuery: (startQuery) => set({ startQuery }),
      close: () =>
        set({
          trace: null,
          playback: null,
          hidden: false,
          status: 'idle',
          stale: false,
          phaseIndex: 0,
          playing: false,
          autoRun: false,
          instant: true,
        }),
    }),
    {
      name: 'vs-scene',
      partialize: (s) => ({ speed: s.speed, autoplay: s.autoplay, followCamera: s.followCamera }),
    },
  ),
);

// Множитель всех скоростей плеера: длительности фаз в аниматорах рассчитаны на него,
// на «1x» сцена идёт вдвое медленнее, чем задано в аниматорах
const SPEED_SCALE = 0.5;

// Скорость с учётом автопроигрывания: после правки запроса не медленнее 2x
export function effectiveSpeed(s: Pick<SceneStore, 'speed' | 'autoRun'>): number {
  return (s.autoRun ? Math.max(2, s.speed) : s.speed) * SPEED_SCALE;
}
