import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sandbox } from '@/features/db/sandbox';
import { DbException, type QueryResult } from '@/features/db/types';
import { initParser } from '@/features/sql/parser';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { SCHEMA } from './__fixtures__/schema';
import { useLiveTrace } from './useLiveTrace';

const RESULT: QueryResult = {
  fields: [{ name: 'title', dataTypeID: 25 }],
  rows: [['Тихий Дон'], ['Остров погибших кораблей']],
  command: 'SELECT',
  rowCount: 2,
};

type PreviewFn = (db: { query: (sql: string) => Promise<QueryResult> }) => Promise<unknown>;

function fakeSandbox(opts: { result?: QueryResult; error?: DbException; calls?: string[] }): Sandbox {
  return {
    status: 'ready',
    datasetId: 'bookstore',
    client: vi.fn(),
    loadLesson: vi.fn(),
    preview: (async (fn: PreviewFn) =>
      fn({
        query: async (sql: string) => {
          opts.calls?.push(sql);
          if (opts.error) throw opts.error;
          return RESULT;
        },
      })) as Sandbox['preview'],
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('после паузы 250 мс выполняет превью и кладёт final-only Trace', async () => {
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
    expect(s.trace?.fallbackReason).toBe('Пошаговый разбор запроса появится позже');
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
});
