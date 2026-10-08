import type { Chapter } from '@content/chapters';
import { describe, expect, it } from 'vitest';
import { getLesson, LESSONS, lessonsByChapter, loadLessonContent, neighbours, sortLessons } from './registry';
import type { LessonMeta } from './types';

const chapters: Chapter[] = [
  { id: 'select', number: 4, title: 'Выборка' },
  { id: 'joins', number: 6, title: 'Соединения' },
];

function lesson(id: string, chapter: string, order: number): LessonMeta {
  return {
    id,
    title: id,
    chapter,
    number: '',
    order,
    dataset: 'bookstore',
    docs: [],
    tags: [],
    path: `/x/${id}.mdx`,
  };
}

describe('sortLessons', () => {
  it('сортирует по номеру главы, затем по order', () => {
    const sorted = sortLessons(
      [
        lesson('left', 'joins', 3),
        lesson('where', 'select', 3),
        lesson('inner', 'joins', 2),
        lesson('sel', 'select', 1),
      ],
      chapters,
    );
    expect(sorted.map((l) => l.id)).toEqual(['sel', 'where', 'inner', 'left']);
  });

  it('неизвестная глава → ошибка с путём урока', () => {
    expect(() => sortLessons([lesson('x', 'nope', 1)], chapters)).toThrow(
      '/x/x.mdx: неизвестная глава «nope»',
    );
  });
});

describe('реестр настоящих уроков', () => {
  it('заглушки найдены и идут в порядке программы', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['how-to-use', 'select-basics']);
  });

  it('getLesson и неизвестный id', () => {
    expect(getLesson('select-basics')?.number).toBe('4.1');
    expect(getLesson('nope')).toBeUndefined();
  });

  it('neighbours на краях и в середине', () => {
    expect(neighbours('how-to-use')).toEqual({ prev: null, next: LESSONS[1] });
    expect(neighbours('select-basics')).toEqual({ prev: LESSONS[0], next: null });
    expect(neighbours('nope')).toEqual({ prev: null, next: null });
  });

  it('lessonsByChapter пропускает пустые главы', () => {
    expect(lessonsByChapter().map((g) => g.chapter.id)).toEqual(['start', 'select']);
  });

  it('loadLessonContent лениво грузит MDX-компонент', async () => {
    const meta = getLesson('how-to-use');
    if (!meta) throw new Error('нет урока how-to-use');
    const mod = await loadLessonContent(meta);
    expect(typeof mod.default).toBe('function');
  });

  it('loadLessonContent для несуществующего пути отклоняется', async () => {
    await expect(loadLessonContent(lesson('ghost', 'select', 1))).rejects.toThrow(
      'Нет файла урока /x/ghost.mdx',
    );
  });
});
