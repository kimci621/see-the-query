import { lessonsMeta } from 'virtual:lessons-meta';
import { CHAPTERS, type Chapter } from '@content/chapters';
import type { ComponentType } from 'react';
import type { LessonMeta } from './types';

type LessonModule = { default: ComponentType<{ components?: Record<string, unknown> }> };

// Тела уроков грузятся лениво, метаданные уже собраны плагином lessons-meta
const loaders = import.meta.glob<LessonModule>('/content/lessons/**/*.mdx');

export function sortLessons(list: LessonMeta[], chapters: Chapter[] = CHAPTERS): LessonMeta[] {
  const chapterNumber = new Map(chapters.map((c) => [c.id, c.number]));
  for (const l of list) {
    if (!chapterNumber.has(l.chapter)) throw new Error(`${l.path}: неизвестная глава «${l.chapter}»`);
  }
  return [...list].sort(
    (a, b) => (chapterNumber.get(a.chapter) ?? 0) - (chapterNumber.get(b.chapter) ?? 0) || a.order - b.order,
  );
}

export const LESSONS: LessonMeta[] = sortLessons(lessonsMeta);

const byId = new Map(LESSONS.map((l) => [l.id, l]));

export function getLesson(id: string): LessonMeta | undefined {
  return byId.get(id);
}

export function loadLessonContent(meta: LessonMeta): Promise<LessonModule> {
  const load = loaders[meta.path];
  if (!load) return Promise.reject(new Error(`Нет файла урока ${meta.path}`));
  return load();
}

export function neighbours(id: string): { prev: LessonMeta | null; next: LessonMeta | null } {
  const index = LESSONS.findIndex((l) => l.id === id);
  if (index === -1) return { prev: null, next: null };
  return { prev: LESSONS[index - 1] ?? null, next: LESSONS[index + 1] ?? null };
}

export function lessonsByChapter(
  list: LessonMeta[] = LESSONS,
): Array<{ chapter: Chapter; lessons: LessonMeta[] }> {
  return CHAPTERS.map((chapter) => ({
    chapter,
    lessons: list.filter((l) => l.chapter === chapter.id),
  })).filter((g) => g.lessons.length > 0);
}
