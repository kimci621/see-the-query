import { useEffect } from 'react';
import { useLessonStore } from '@/stores/lesson';
import type { LessonMeta } from './types';

// Метка end в конце урока показалась на экране: урок дочитан. «Пройден» стор ставит сам,
// когда запущен и пример. Текст редактора и lastQuery ведёт EditorPane
export function useLessonProgress(meta: LessonMeta, end: Element | null): void {
  useEffect(() => {
    if (!end) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) useLessonStore.getState().markReadToEnd(meta.id);
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [meta.id, end]);
}
