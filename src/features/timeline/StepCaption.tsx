import { useSceneStore } from '@/stores/scene';

// Подпись текущего шага сцены для компактного режима: над доской, а не в тесной панели плеера.
// Текст не обрезаем: на крупном шрифте это единственное объяснение происходящего на кадре
export function StepCaption() {
  const playback = useSceneStore((s) => s.playback);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const caption = playback?.phases[phaseIndex]?.caption;
  if (!caption) return null;
  return (
    <p
      data-testid="timeline-caption"
      aria-live="polite"
      title={caption}
      className="shrink-0 border-b bg-background px-3 py-2 text-sm leading-snug"
    >
      {caption}
    </p>
  );
}
