import { type RefObject, useEffect } from 'react';
import { useSceneStore } from '@/stores/scene';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')
  );
}

// Клавиши плеера работают, когда фокус на доске и не в поле ввода
export function useBoardHotkeys(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      // Только сама доска: автоповтор (Space зажат для пана) и клавиши на кнопках внутри не трогают плеер
      if (e.repeat || e.target !== e.currentTarget || isEditable(e.target)) return;
      const scene = useSceneStore.getState();
      if (e.key === ' ') {
        e.preventDefault();
        scene.toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scene.step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        scene.step(1);
      } else if (e.key === 'Escape') {
        // Прячем только сцену: призраки растворяются, итог запроса остаётся, плеер её вернёт
        scene.hide();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref]);
}
