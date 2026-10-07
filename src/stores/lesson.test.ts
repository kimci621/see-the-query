import { beforeEach, describe, expect, it } from 'vitest';
import { lessonStatus, useLessonStore } from '@/stores/lesson';

beforeEach(() => useLessonStore.setState({ byId: {} }));

describe('lessonStatus', () => {
  it('нет записи → new', () => {
    expect(lessonStatus(undefined)).toBe('new');
  });

  it('visited и completed', () => {
    const base = { visited: true, completed: false, journal: [], ranExample: false };
    expect(lessonStatus(base)).toBe('visited');
    expect(lessonStatus({ ...base, completed: true })).toBe('completed');
  });
});

describe('useLessonStore', () => {
  it('markVisited создаёт запись и не трогает другие поля', () => {
    useLessonStore.getState().setLastQuery('inner-join', 'select 1');
    useLessonStore.getState().markVisited('inner-join');
    expect(useLessonStore.getState().byId['inner-join']).toMatchObject({
      visited: true,
      completed: false,
      lastQuery: 'select 1',
      journal: [],
      ranExample: false,
    });
  });

  it('setJournal, setViewport, markRanExample, markCompleted', () => {
    const s = useLessonStore.getState();
    s.setJournal('a', ['insert into t values (1)']);
    s.setViewport('a', { x: 1, y: 2, zoom: 0.5 });
    s.markRanExample('a');
    s.markCompleted('a');
    expect(useLessonStore.getState().byId.a).toMatchObject({
      journal: ['insert into t values (1)'],
      viewport: { x: 1, y: 2, zoom: 0.5 },
      ranExample: true,
      completed: true,
    });
  });
});
