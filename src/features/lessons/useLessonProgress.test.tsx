import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLessonStore } from '@/stores/lesson';
import type { LessonMeta } from './types';
import { useLessonProgress } from './useLessonProgress';

const meta: LessonMeta = {
  id: 'inner-join',
  title: 'INNER JOIN, ON и USING',
  chapter: 'joins',
  number: '6.2',
  order: 2,
  dataset: 'bookstore',
  docs: [],
  tags: [],
  path: '/content/lessons/06-joins/02-inner-join.mdx',
  initialQuery: 'select * from book;',
};

// Ручной IntersectionObserver: reveal(true) = метка конца урока показалась на экране
let reveal: (visible: boolean) => void = () => {};
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    reveal = (visible) =>
      callback(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  observe() {}
  disconnect() {}
}

function Harness() {
  const [end, setEnd] = useState<HTMLDivElement | null>(null);
  useLessonProgress(meta, end);
  return <div ref={setEnd} />;
}

const progress = () => useLessonStore.getState().byId['inner-join'];

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  useLessonStore.setState({ byId: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('useLessonProgress', () => {
  it('дочитал, потом запустил пример: пройден только после запуска', () => {
    render(<Harness />);
    act(() => reveal(true));
    expect(progress()?.completed ?? false).toBe(false);
    act(() => useLessonStore.getState().markRanExample('inner-join'));
    expect(progress()?.completed).toBe(true);
  });

  it('запустил пример, потом дочитал: пройден только после дочитывания', () => {
    render(<Harness />);
    act(() => useLessonStore.getState().markRanExample('inner-join'));
    expect(progress()?.completed ?? false).toBe(false);
    act(() => reveal(false));
    expect(progress()?.completed ?? false).toBe(false);
    act(() => reveal(true));
    expect(progress()?.completed).toBe(true);
  });
});
