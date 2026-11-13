import { lessonsMeta } from 'virtual:lessons-meta';
import { CHAPTERS, type Chapter, chapterTitle } from '@content/chapters';
import type { ComponentType } from 'react';
import type { Locale } from '@/lib/i18n';
import type { LessonMeta } from './types';

type LessonModule = { default: ComponentType<{ components?: Record<string, unknown> }> };

// Тела уроков грузятся лениво, метаданные уже собраны плагином lessons-meta
const loaders = import.meta.glob<LessonModule>(['/content/lessons/**/*.mdx', '/content/lessons-en/**/*.mdx']);

export function sortLessons(list: LessonMeta[], chapters: Chapter[] = CHAPTERS): LessonMeta[] {
  const chapterNumber = new Map(chapters.map((c) => [c.id, c.number]));
  for (const l of list) {
    if (!chapterNumber.has(l.chapter)) throw new Error(`${l.path}: неизвестная глава «${l.chapter}»`);
  }
  return [...list].sort(
    (a, b) => (chapterNumber.get(a.chapter) ?? 0) - (chapterNumber.get(b.chapter) ?? 0) || a.order - b.order,
  );
}

export const LESSONS: LessonMeta[] = sortLessons(lessonsMeta.filter((l) => l.locale === 'ru'));

const byLocale = {
  ru: new Map(LESSONS.map((l) => [l.id, l])),
  en: new Map(lessonsMeta.filter((l) => l.locale === 'en').map((l) => [l.id, l])),
};

export function getLesson(id: string, locale: Locale = 'ru'): LessonMeta | undefined {
  return byLocale[locale].get(id);
}

export function lessonsForLocale(locale: Locale): LessonMeta[] {
  if (locale === 'ru') return LESSONS;
  return LESSONS.map(
    (lesson) =>
      byLocale.en.get(lesson.id) ?? {
        ...lesson,
        locale: 'en',
        title: `Lesson ${lesson.number}`,
        tags: [],
        docs: [],
        initialQuery: undefined,
        path: '',
      },
  );
}

export function loadLessonContent(meta: LessonMeta): Promise<LessonModule> {
  const load = loaders[meta.path];
  if (!load) return Promise.reject(new Error(`Нет файла урока ${meta.path}`));
  return load();
}

export function neighbours(
  id: string,
  locale: Locale = 'ru',
): { prev: LessonMeta | null; next: LessonMeta | null } {
  const index = LESSONS.findIndex((l) => l.id === id);
  if (index === -1) return { prev: null, next: null };
  const lessons = lessonsForLocale(locale);
  return { prev: lessons[index - 1] ?? null, next: lessons[index + 1] ?? null };
}

export function lessonsByChapter(
  list: LessonMeta[] = LESSONS,
  locale: Locale = 'ru',
): Array<{ chapter: Chapter; lessons: LessonMeta[] }> {
  return CHAPTERS.map((chapter) => ({
    chapter: { ...chapter, title: chapterTitle(chapter, locale) },
    lessons: list.filter((l) => l.chapter === chapter.id),
  })).filter((g) => g.lessons.length > 0);
}
