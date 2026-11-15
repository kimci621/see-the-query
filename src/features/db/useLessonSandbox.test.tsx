import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';
import type { Sandbox, SandboxEvent, SequenceCheckpoint } from './sandbox';
import { RESTART_MESSAGES, useLessonSandbox } from './useLessonSandbox';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

const journalValue = (journal: Parameters<Sandbox['loadLesson']>[1]) =>
  typeof journal === 'function' ? journal() : journal;

// Песочница-заглушка: журнал и события под контролем теста
function fakeSandbox() {
  let listener: (e: SandboxEvent) => void = () => {};
  let finish: () => void = () => {};
  let journal: string[] = [];
  let checkpoints: SequenceCheckpoint[] = [];
  const sandbox = {
    loadLesson: vi.fn((_id: string, j: Parameters<Sandbox['loadLesson']>[1]) => {
      journal = [...journalValue(j)];
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }),
    journal: () => journal,
    sequenceCheckpoints: () => checkpoints,
    whenIdle: () => Promise.resolve(),
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
    setCheckpoints: (values: SequenceCheckpoint[]) => {
      checkpoints = values;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  useLessonStore.setState({ byId: {} });
  useSettingsStore.setState({ locale: 'ru' });
  vi.clearAllMocks();
});

describe('useLessonSandbox', () => {
  it('сохраняет применение, завершившееся после смены языка', async () => {
    let current = ['русский запрос'];
    const listeners = new Set<(event: SandboxEvent) => void>();
    let finishFence = () => {};
    const sandbox = {
      journal: () => current,
      sequenceCheckpoints: () => [],
      subscribe: (listener: (event: SandboxEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      loadLesson: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementation(() => new Promise(() => {})),
      whenIdle: () =>
        new Promise<void>((resolve) => {
          finishFence = resolve;
        }),
    } as unknown as Sandbox;
    await act(async () => {
      renderHook(() => useLessonSandbox(sandbox, 'lesson', 'bookstore'));
    });
    act(() => useSettingsStore.setState({ locale: 'en' }));
    current = ['русский запрос', 'запрос завершился после переключения'];
    act(() => {
      for (const listener of listeners) listener({ type: 'changed' });
    });
    expect(useLessonStore.getState().byId.lesson.workspaces.ru?.journal).toEqual(current);
    await act(async () => finishFence());
  });

  it('при быстром возврате загружает журнал после завершения предыдущей команды', async () => {
    let current = ['первый запрос'];
    let finishFence = () => {};
    const listeners = new Set<(event: SandboxEvent) => void>();
    const sandbox = {
      journal: () => current,
      sequenceCheckpoints: () => [],
      subscribe: (listener: (event: SandboxEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      loadLesson: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementation(() => new Promise(() => {})),
      whenIdle: () =>
        new Promise<void>((resolve) => {
          finishFence = resolve;
        }),
    } as unknown as Sandbox;
    await act(async () => {
      renderHook(() => useLessonSandbox(sandbox, 'lesson', 'bookstore'));
    });
    act(() => useSettingsStore.setState({ locale: 'en' }));
    act(() => useSettingsStore.setState({ locale: 'ru' }));
    current = ['первый запрос', 'завершённая команда'];
    act(() => {
      for (const listener of listeners) listener({ type: 'changed' });
    });
    await act(async () => finishFence());
    const last = vi.mocked(sandbox.loadLesson).mock.calls.at(-1);
    expect(last?.[0]).toBe('bookstore');
    expect(last?.[2]).toBe('ru');
    expect(last && journalValue(last[1])).toEqual(current);
  });

  it('быстрое ru → en → ru не записывает запоздавшие журналы в чужую область', async () => {
    const store = useLessonStore.getState();
    store.setJournal('lesson', ['русский запрос'], 'ru');
    store.setJournal('lesson', ['english query'], 'en');
    let current: string[] = [];
    const listeners = new Set<(event: SandboxEvent) => void>();
    const pending: Array<() => void> = [];
    const sandbox = {
      journal: () => current,
      sequenceCheckpoints: () => [],
      whenIdle: () => Promise.resolve(),
      subscribe: (listener: (event: SandboxEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      loadLesson: vi.fn(
        (_id: string, journal: Parameters<Sandbox['loadLesson']>[1]) =>
          new Promise<void>((resolve) => {
            pending.push(() => {
              current = [...journalValue(journal)];
              for (const listener of listeners) listener({ type: 'changed' });
              resolve();
            });
          }),
      ),
    } as unknown as Sandbox;
    renderHook(() => useLessonSandbox(sandbox, 'lesson', 'bookstore'));
    act(() => useSettingsStore.setState({ locale: 'en' }));
    act(() => useSettingsStore.setState({ locale: 'ru' }));
    expect(sandbox.loadLesson).toHaveBeenCalledTimes(3);
    for (const complete of pending) await act(async () => complete());
    expect(useLessonStore.getState().byId.lesson.workspaces).toMatchObject({
      ru: { journal: ['русский запрос'] },
      en: { journal: ['english query'] },
    });
  });

  it('ошибка загрузки английской области не затирает сохранённые журналы', async () => {
    const store = useLessonStore.getState();
    store.setJournal('lesson', ['русский запрос'], 'ru');
    store.setJournal('lesson', ['english query'], 'en');
    useSettingsStore.setState({ locale: 'en' });
    const sandbox = {
      loadLesson: vi.fn().mockRejectedValue(new Error('load failed')),
      journal: () => ['чужой журнал'],
      sequenceCheckpoints: () => [],
      subscribe: () => () => {},
    } as unknown as Sandbox;
    await act(async () => {
      renderHook(() => useLessonSandbox(sandbox, 'lesson', 'bookstore'));
    });
    expect(useLessonStore.getState().byId.lesson.workspaces).toMatchObject({
      ru: { journal: ['русский запрос'] },
      en: { journal: ['english query'] },
    });
  });

  it('поднимает датасет с журналом из localStorage', () => {
    useLessonStore.getState().setJournal('dml-insert', ['delete from review']);
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    const call = vi.mocked(f.sandbox.loadLesson).mock.calls[0];
    expect(call[0]).toBe('bookstore');
    expect(call[2]).toBe('ru');
    expect(journalValue(call[1])).toEqual(['delete from review']);
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
    expect(saved.state.byId['dml-insert'].workspaces.ru.journal).toEqual(['delete from review']);
  });

  it('сохраняет состояние последовательности после неудачного применения отдельно для языка', async () => {
    useSettingsStore.setState({ locale: 'en' });
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'lesson', 'bookstore'));
    await f.finish();
    const checkpoints = [{ at: 0, values: { 'public.customer_customer_id_seq': '7' } }];
    f.setCheckpoints(checkpoints);
    f.emit({ type: 'journalChanged' });
    const saved = JSON.parse(localStorage.getItem('vs-lessons') ?? '{}');
    expect(saved.state.byId.lesson.workspaces.en).toMatchObject({
      journal: [],
      sequenceCheckpoints: checkpoints,
    });
    expect(saved.state.byId.lesson.workspaces.ru).toBeUndefined();
  });

  it('передаёт сохранённые состояния последовательностей в загрузку выбранного языка', () => {
    const ru = [{ at: 0, values: { 'public.author_author_id_seq': '7' } }];
    const en = [{ at: 0, values: { 'public.customer_customer_id_seq': '7' } }];
    const store = useLessonStore.getState();
    store.setJournal('lesson', [], 'ru', ru);
    store.setJournal('lesson', [], 'en', en);
    useSettingsStore.setState({ locale: 'en' });
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'lesson', 'bookstore'));
    const saved = vi.mocked(f.sandbox.loadLesson).mock.calls[0]?.[3];
    expect(typeof saved === 'function' ? saved() : saved).toEqual(en);
  });

  it('после перезапуска показывает тост с причиной', () => {
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    f.emit({ type: 'restarted', reason: 'timeout' });
    expect(toast.warning).toHaveBeenCalledWith(RESTART_MESSAGES.timeout);
  });

  it('сообщает о перезапуске на выбранном языке', () => {
    useSettingsStore.setState({ locale: 'en' });
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(f.sandbox, 'dml-insert', 'bookstore'));
    f.emit({ type: 'restarted', reason: 'crash' });
    expect(toast.warning).toHaveBeenCalledWith('The sandbox restarted and your changes were restored.');
  });

  it('без песочницы или урока ничего не делает', () => {
    const f = fakeSandbox();
    renderHook(() => useLessonSandbox(null, 'dml-insert', 'bookstore'));
    renderHook(() => useLessonSandbox(f.sandbox, undefined, undefined));
    expect(f.sandbox.loadLesson).not.toHaveBeenCalled();
  });
});
