import { useEffect } from 'react';
import { effectiveSpeed, useSceneStore } from '@/stores/scene';

// Таймер проигрывания: через длительность фазы (с учётом скорости) переходим к следующей
export function usePlayer(): void {
  const playing = useSceneStore((s) => s.playing);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const playback = useSceneStore((s) => s.playback);
  const speed = useSceneStore(effectiveSpeed);
  const duration = playback?.phases[phaseIndex]?.durationMs ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: phaseIndex restarts the timer even when phases have equal duration
  useEffect(() => {
    if (!playing || !playback) return;
    const id = window.setTimeout(() => useSceneStore.getState().advance(), duration / speed);
    return () => window.clearTimeout(id);
  }, [playing, phaseIndex, playback, duration, speed]);
}
