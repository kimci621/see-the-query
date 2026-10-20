import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sandbox, SandboxEvent } from '@/features/db/sandbox';
import { DbException, type QueryResult } from '@/features/db/types';
import { initParser } from '@/features/sql/parser';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { SCHEMA } from './__fixtures__/schema';
import { useLiveTrace } from './useLiveTrace';

const { traceStatement } = vi.hoisted(() => ({ traceStatement: vi.fn() }));
vi.mock('@/features/tracer/trace', () => ({ traceStatement }));

const RESULT: QueryResult = {
  fields: [{ name: 'title', dataTypeID: 25 }],
  rows: [['Тихий Дон'], ['Остров погибших кораблей']],
  command: 'SELECT',
  rowCount: 2,
};

type PreviewFn = (db: { query: (sql: string) => Promise<QueryResult> }) => Promise<unknown>;

function fakeSandbox(opts: {
  result?: QueryResult;
  error?: DbException;
  calls?: string[];
  previews?: { n: number };
}): Sandbox {
  return {
    status: 'ready',
    datasetId: 'bookstore',
    client: vi.fn(),
    loadLesson: vi.fn(),
    preview: (async (fn: PreviewFn) => {
      if (opts.previews) opts.previews.n += 1;
      return fn({
        query: async (sql: string) => {
          opts.calls?.push(sql);
          if (opts.error) throw opts.error;
          return RESULT;
        },
      });
    }) as Sandbox['preview'],
    apply: vi.fn(),
    undo: vi.fn(),
    reset: vi.fn(),
    journal: () => [],
    subscribe: () => () => undefined,
  } as unknown as Sandbox;
}

describe('useLiveTrace', () => {
  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useSceneStore.setState({ ...useSceneStore.getInitialState(), generation: 0 }, true);
    useBoardStore.setState(useBoardStore.getInitialState(), true);
    traceStatement.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('со схемой превью строит трассу через traceStatement, подсветка из редактора', async () => {
    const trace = {
      mode: 'full',
      stages: [],
      result: RESULT,
      error: null,
      touched: { tableIds: [], columns: [] },
    };
    traceStatement.mockResolvedValue(trace as unknown as Trace);
    useBoardStore.getState().setSchema(SCHEMA);
    useEditorStore.getState().setText('select title from book');
    renderHook(() => useLiveTrace(fakeSandbox({})));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(traceStatement).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'select title from book' }),
      expect.anything(),
      {
        schema: SCHEMA,
      },
    );
    const s = useSceneStore.getState().trace;
    expect(s?.mode).toBe('full');
    expect(s?.touched.tableIds).toEqual(['public.book']);
  });

  it('сбой трассировщика (не ошибка базы): итог прямым выполнением, final-only', async () => {
    traceStatement.mockRejectedValue(new TypeError('bug'));
    const calls: string[] = [];
    const sandbox = fakeSandbox({ calls });
    useBoardStore.getState().setSchema(SCHEMA);
    useEditorStore.getState().setText('select title from book');

    renderHook(() => useLiveTrace(sandbox));
    expect(calls).toHaveLength(0); // до паузы ничего не выполняется

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toEqual(['select title from book']);
    const s = useSceneStore.getState();
    expect(s.status).toBe('ready');
    expect(s.trace?.mode).toBe('final-only');
    expect(s.trace?.result).toEqual(RESULT);
    expect(s.trace?.touched.tableIds).toEqual(['public.book']);
    expect(s.trace?.fallbackReason).toBe('Пошаговый разбор недоступен');
  });

  it('сбой трассировщика: итог в отдельном превью, оператор не выполняется второй раз в той же транзакции', async () => {
    traceStatement.mockRejectedValue(new TypeError('bug'));
    const previews = { n: 0 };
    const sandbox = fakeSandbox({ previews });
    useBoardStore.getState().setSchema(SCHEMA);
    useEditorStore.getState().setText('select title from book');

    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(previews.n).toBe(2);
    expect(useSceneStore.getState().trace?.result).toEqual(RESULT);
  });

  it('новый ввод отменяет невыполненное превью старого поколения', async () => {
    const calls: string[] = [];
    const sandbox = fakeSandbox({ calls });
    useEditorStore.getState().setText('select 1');

    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // не дождались
    });
    useEditorStore.getState().setText('select 2');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    // выполняется только последний текст
    expect(calls).toEqual(['select 2']);
    expect(useSceneStore.getState().trace?.sql).toBe('select 2');
  });

  it('ошибка парсинга: подчёркивание в сторе, сцена гаснет, запроса нет', async () => {
    const calls: string[] = [];
    const sandbox = fakeSandbox({ calls });
    useEditorStore.getState().setText('select from');

    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toHaveLength(0);
    expect(useEditorStore.getState().parseError?.message).toBeTruthy();
    expect(useSceneStore.getState().stale).toBe(true);
  });

  it('ошибка Postgres попадает в trace.error', async () => {
    const sandbox = fakeSandbox({
      error: new DbException({
        code: '42703',
        message: 'column "nme" does not exist',
        position: 8,
      }),
    });
    useEditorStore.getState().setText('select nme from book');

    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const trace = useSceneStore.getState().trace;
    expect(trace?.error?.code).toBe('42703');
    expect(trace?.result).toBeNull();
  });

  it('пустой текст закрывает сцену', async () => {
    const sandbox = fakeSandbox({});
    useEditorStore.getState().setText('select 1');
    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    useEditorStore.getState().setText('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(useSceneStore.getState().trace).toBeNull();
    expect(useSceneStore.getState().status).toBe('idle');
  });

  it('перевод курсора во второй оператор перевыбирает превью', async () => {
    const calls: string[] = [];
    const sandbox = fakeSandbox({ calls });
    useEditorStore.getState().setText('select 1; select 2');
    useEditorStore.getState().setCursor(3);

    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toEqual(['select 1']);

    useEditorStore.getState().setCursor(15);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toEqual(['select 1', 'select 2']);
  });

  it('применённый оператор не перевыполняется до правки текста: результат = итог применения (P8.50)', async () => {
    const calls: string[] = [];
    const listeners = new Set<(e: SandboxEvent) => void>();
    const sandbox = {
      ...fakeSandbox({ calls }),
      subscribe: (l: (e: SandboxEvent) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    } as unknown as Sandbox;
    const emit = (e: SandboxEvent) => {
      for (const l of listeners) l(e);
    };
    const create = 'create table mine (id int)';
    useEditorStore.getState().setText(create);
    renderHook(() => useLiveTrace(sandbox));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toEqual([create]);

    const outcome = { sql: create, result: null, error: null } as unknown as Trace;
    act(() => {
      useEditorStore.getState().markApplied(0, outcome);
      emit({ type: 'changed', apply: { since: 750, command: 'CREATE' } });
    });
    // новая схема после «Применить» тоже не перезапускает превью
    act(() => useBoardStore.getState().setSchema(SCHEMA));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toEqual([create]);
    expect(useSceneStore.getState().trace).toBe(outcome);
    expect(useSceneStore.getState().status).toBe('ready');

    // отмена: оператор больше не применён, превью снова выполняется
    act(() => emit({ type: 'changed' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(useEditorStore.getState().applied).toEqual({});
    expect(calls).toEqual([create, create]);
  });
});
