import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLessonStore } from '@/stores/lesson';
import type { Sandbox, SandboxEvent } from './sandbox';
import { RESTART_MESSAGES, useLessonSandbox } from './useLessonSandbox';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

// Песочница-заглушка: журнал и события под контролем теста
function fakeSandbox() {
  let listener: (e: SandboxEvent) => void = () => {};
  let finish: () => void = () => {};
  let journal: string[] = [];
  const sandbox = {
    loadLesson: vi.fn((_id: string, j: readonly string[]) => {
      journal = [...j];
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }),
    journal: () => journal,
    subscribe: (l: (e: SandboxEvent) => void) => {
      listener = l;
      return () => {
        listener = () => {};
      };
    },
  } as unknown as Sandbox;
  return {
    sandbox,
    emit: (e: SandboxEvent) => listener(e),
    finish: () => act(async () => finish()),
    setJournal: (j: string[]) => {
      journal = j;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  useLessonStore.setState({ byId: {} });
  vi.clearAllMocks();
});

describe('useLessonSandbox', () => {
  it('поднимает датасет с журналом из localStorage', () => {
    useLessonStore.getState().setJournal('dml-insert', ['delete from review']);
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    expect(f.sandbox.loadLesson).toHaveBeenCalledWith('bookstore', ['delete from review']);
  });

  it('после загрузки пишет журнал в localStorage на каждое изменение', async () => {
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    f.setJournal(['чужой журнал']);
    f.emit({ type: 'changed' }); // событие прошлого урока до окончания загрузки
    expect(useLessonStore.getState().byId['dml-insert']).toBeUndefined();

    await f.finish();
    f.setJournal(['delete from review']);
    f.emit({ type: 'changed' });
    const saved = JSON.parse(localStorage.getItem('vs-lessons') ?? '{}');
    expect(saved.state.byId['dml-insert'].journal).toEqual(['delete from review']);
  });

  it('после перезапуска показывает тост с причиной', () => {
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    f.emit({ type: 'restarted', reason: 'timeout' });
    expect(toast.warning).toHaveBeenCalledWith(RESTART_MESSAGES.timeout);
  });

  it('без песочницы или урока ничего не делает', () => {
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(null, 'dml-insert', 'bookstore'));
    renderHook(() => useLessonSandbox(f.sandbox, undefined, undefined));
    expect(f.sandbox.loadLesson).not.toHaveBeenCalled();
  });
});
