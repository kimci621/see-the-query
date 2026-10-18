import { useEffect } from 'react';
import { useLessonStore } from '@/stores/lesson';
import type { LessonMeta } from './types';

// Отметка «пройден»: урок дочитан до метки end и запущен хотя бы один пример, порядок любой.
// Текст редактора и lastQuery ведёт EditorPane
export function useLessonProgress(meta: LessonMeta, end: Element | null): void {
  useEffect(() => {
    if (!end) return;
    let reachedEnd = false;
    const tryComplete = () => {
      const p = useLessonStore.getState().byId[meta.id];
      if (reachedEnd && p?.ranExample && !p.completed) useLessonStore.getState().markCompleted(meta.id);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      reachedEnd = true;
      tryComplete();
    });
    observer.observe(end);
    const unsubscribe = useLessonStore.subscribe(tryComplete);
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [meta.id, end]);
}
