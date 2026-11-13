import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:lessons-meta', () => ({
  lessonsMeta: [
    {
      id: 'first',
      locale: 'ru',
      title: 'Первый',
      chapter: 'start',
      number: '0.1',
      order: 1,
      dataset: 'empty',
      docs: [],
      tags: [],
      path: '/ru/first.mdx',
    },
    {
      id: 'second',
      locale: 'ru',
      title: 'Второй',
      chapter: 'start',
      number: '0.2',
      order: 2,
      dataset: 'empty',
      docs: [],
      tags: [],
      path: '/ru/second.mdx',
    },
    {
      id: 'first',
      locale: 'en',
      title: 'First',
      chapter: 'start',
      number: '0.1',
      order: 1,
      dataset: 'empty',
      docs: [],
      tags: ['begin'],
      path: '/en/first.mdx',
    },
  ],
}));

import { getLesson, lessonsForLocale, neighbours } from './registry';

describe('языковые версии реестра', () => {
  it('выбирает перевод по id и языку', () => {
    expect(getLesson('first', 'en')?.title).toBe('First');
    expect(getLesson('first', 'ru')?.title).toBe('Первый');
    expect(getLesson('second', 'en')).toBeUndefined();
  });

  it('сохраняет порядок и обозначает недоступный перевод без русского названия', () => {
    expect(lessonsForLocale('en').map(({ id, title }) => [id, title])).toEqual([
      ['first', 'First'],
      ['second', 'Lesson 0.2'],
    ]);
    expect(neighbours('second', 'en').prev?.title).toBe('First');
  });
});
