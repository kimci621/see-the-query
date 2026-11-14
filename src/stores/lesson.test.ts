import { beforeEach, describe, expect, it } from 'vitest';
import { lessonStatus, useLessonStore } from '@/stores/lesson';

beforeEach(() => useLessonStore.setState({ byId: {} }));

describe('lessonStatus', () => {
  it('нет записи → new', () => {
    expect(lessonStatus(undefined)).toBe('new');
  });

  it('visited и completed', () => {
    const base = { visited: true, completed: false, workspaces: {}, ranExample: false };
    expect(lessonStatus(base)).toBe('visited');
    expect(lessonStatus({ ...base, completed: true })).toBe('completed');
  });
});

describe('useLessonStore', () => {
  it('переносит старые сохранения в русскую область без потери прогресса', async () => {
    const viewport = { x: 4, y: -8, zoom: 0.7 };
    localStorage.setItem(
      'vs-lessons',
      JSON.stringify({
        state: {
          byId: {
            lesson: {
              visited: true,
              completed: true,
              ranExample: true,
              readToEnd: true,
              lastQuery: 'select 1',
              journal: ['insert into t values (1)'],
              viewport,
            },
          },
        },
        version: 1,
      }),
    );
    await useLessonStore.persist.rehydrate();
    expect(useLessonStore.getState().byId.lesson).toEqual({
      visited: true,
      completed: true,
      ranExample: true,
      readToEnd: true,
      workspaces: { ru: { lastQuery: 'select 1', journal: ['insert into t values (1)'], viewport } },
    });
    expect(JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').version).toBe(2);
  });

  it('хранит SQL, журнал и камеру отдельно и восстанавливает их после перезагрузки', async () => {
    const s = useLessonStore.getState();
    s.markVisited('lesson');
    s.setLastQuery('lesson', 'select 1', 'ru');
    s.setJournal('lesson', ['insert into t values (1)'], 'ru');
    s.setViewport('lesson', { x: 1, y: 2, zoom: 1 }, 'ru');
    s.setLastQuery('lesson', 'select 2', 'en');
    s.setJournal('lesson', ['insert into t values (2)'], 'en');
    s.setViewport('lesson', { x: 3, y: 4, zoom: 0.5 }, 'en');
    const saved = localStorage.getItem('vs-lessons');
    useLessonStore.setState({ byId: {} });
    localStorage.setItem('vs-lessons', saved ?? '');
    await useLessonStore.persist.rehydrate();
    expect(useLessonStore.getState().byId.lesson).toMatchObject({
      visited: true,
      workspaces: {
        ru: {
          lastQuery: 'select 1',
          journal: ['insert into t values (1)'],
          viewport: { x: 1, y: 2, zoom: 1 },
        },
        en: {
          lastQuery: 'select 2',
          journal: ['insert into t values (2)'],
          viewport: { x: 3, y: 4, zoom: 0.5 },
        },
      },
    });
  });

  it('markVisited создаёт запись и не трогает другие поля', () => {
    useLessonStore.getState().setLastQuery('inner-join', 'select 1');
    useLessonStore.getState().markVisited('inner-join');
    expect(useLessonStore.getState().byId['inner-join']).toMatchObject({
      visited: true,
      completed: false,
      workspaces: { ru: { lastQuery: 'select 1', journal: [] } },
      ranExample: false,
    });
  });

  it('setJournal, setViewport, markRanExample', () => {
    const s = useLessonStore.getState();
    s.setJournal('a', ['insert into t values (1)']);
    s.setViewport('a', { x: 1, y: 2, zoom: 0.5 });
    s.markRanExample('a');
    expect(useLessonStore.getState().byId.a).toMatchObject({
      workspaces: { ru: { journal: ['insert into t values (1)'], viewport: { x: 1, y: 2, zoom: 0.5 } } },
      ranExample: true,
      completed: false,
    });
  });

  it('пройден = дочитал и запустил пример, в любом порядке', () => {
    const s = useLessonStore.getState();
    s.markReadToEnd('a');
    expect(useLessonStore.getState().byId.a?.completed).toBe(false);
    s.markRanExample('a');
    expect(useLessonStore.getState().byId.a).toMatchObject({ readToEnd: true, completed: true });
    s.markRanExample('b');
    s.markReadToEnd('b');
    expect(useLessonStore.getState().byId.b?.completed).toBe(true);
  });
});
