import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA } from '@/features/editor/__fixtures__/schema';
import { initParser } from '@/features/sql/parser';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { EditorPane } from './EditorPane';

// CodeMirror в этом тесте не нужен: проверяем эффекты связи, редактор подменён
vi.mock('./SqlEditor', () => ({ SqlEditor: () => null }));
const sandboxState = vi.hoisted(() => ({ sandbox: null as unknown }));
vi.mock('@/features/db/SandboxProvider', () => ({
  useSandbox: () => ({ sandbox: sandboxState.sandbox, status: 'ready', version: null }),
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ lessonId: null }),
}));

beforeEach(async () => {
  sandboxState.sandbox = null;
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSceneStore.setState({ ...useSceneStore.getInitialState(), generation: 0 }, true);
  useBoardStore.setState(useBoardStore.getInitialState(), true);
  useBoardStore.getState().setSchema(SCHEMA);
  await initParser();
});

describe('EditorPane: связь курсор-клауз-доска', () => {
  it('курсор в клаузе FROM пишет activeClause в стор', async () => {
    render(<EditorPane />);
    act(() => {
      useEditorStore.getState().setText('select b.title from book b where price > 500');
      useEditorStore.getState().setCursor(22); // внутри 'book b'
    });
    await act(async () => undefined); // эффекты EditorPane отработали
    expect(useEditorStore.getState().activeClause).toBe('from');
    act(() => {
      useEditorStore.getState().setCursor(36); // внутри 'price > 500'
    });
    await act(async () => undefined);
    expect(useEditorStore.getState().activeClause).toBe('where');
  });

  it('activeClause=from фокусирует таблицы оператора на доске', async () => {
    render(<EditorPane />);
    act(() => {
      useEditorStore.getState().setText('select * from author');
      useEditorStore.getState().setCursor(15);
    });
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
  });

  const traceOf = (sql: string, statementType: 'select' | 'insert' | 'update' | 'delete') => ({
    sql,
    statementType,
    mode: 'final-only' as const,
    touched: { tableIds: [], columns: [], expanded: [] },
    stages: [],
    result: null,
    error: null,
    notices: [],
    timingMs: 1,
  });

  it.each([
    ["insert into author (name) values ('Ада')", 'insert'],
    ["update author set name = 'Ада' where id in (select author_id from book)", 'update'],
    ['delete from author using book where book.author_id = author.id', 'delete'],
  ] as const)('трейс DML фокусирует целевую таблицу: %s', async (sql, type) => {
    render(<EditorPane />);
    act(() =>
      useSceneStore.getState().setTrace(traceOf(sql, type), useSceneStore.getState().nextGeneration()),
    );
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
  });

  it('трейс SELECT не двигает фокус', async () => {
    render(<EditorPane />);
    act(() => useBoardStore.getState().focus(['public.author']));
    act(() =>
      useSceneStore
        .getState()
        .setTrace(traceOf('select * from book', 'select'), useSceneStore.getState().nextGeneration()),
    );
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
  });

  it('hoveredColumn подсвечивает колонку, уход с hover возвращает подсветку трейса', async () => {
    const trace = {
      sql: 'select title from book',
      statementType: 'select' as const,
      mode: 'final-only' as const,
      touched: { tableIds: ['public.book'], columns: ['public.book.title'], expanded: [] },
      stages: [],
      result: null,
      error: null,
      notices: [],
      timingMs: 1,
    };
    useSceneStore.getState().nextGeneration();
    useSceneStore.getState().setTrace(trace, 1);
    render(<EditorPane />);
    act(() => {
      useEditorStore.getState().setHoveredColumn('public.author.name');
    });
    await act(async () => undefined);
    expect(useBoardStore.getState().highlightedColumns).toEqual(['public.author.name']);
    act(() => {
      useEditorStore.getState().setHoveredColumn(null);
    });
    await act(async () => undefined);
    expect(useBoardStore.getState().highlightedColumns).toEqual(['public.book.title']);
  });

  it('hover меняет подсветку, но не свёртку: колонки трейса остаются, наведённая добавляется', async () => {
    const trace = {
      sql: 'select title, price from book',
      statementType: 'select' as const,
      mode: 'final-only' as const,
      touched: {
        tableIds: ['public.book'],
        columns: ['public.book.title', 'public.book.price'],
        expanded: [],
      },
      stages: [],
      result: null,
      error: null,
      notices: [],
      timingMs: 1,
    };
    useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration());
    render(<EditorPane />);
    act(() => useEditorStore.getState().setHoveredColumn('public.book.author_id'));
    await act(async () => undefined);
    const board = useBoardStore.getState();
    expect(board.highlightedColumns).toEqual(['public.book.author_id']);
    expect(board.queryColumns).toEqual(['public.book.title', 'public.book.price', 'public.book.author_id']);
    act(() => useEditorStore.getState().setHoveredColumn(null));
    await act(async () => undefined);
    expect(useBoardStore.getState().queryColumns).toEqual(['public.book.title', 'public.book.price']);
  });

  it('звёздочка трейса разворачивает таблицу на доске, закрытая сцена сворачивает', async () => {
    const trace = {
      sql: 'select * from book',
      statementType: 'select' as const,
      mode: 'final-only' as const,
      touched: { tableIds: ['public.book'], columns: [], expanded: ['public.book'] },
      stages: [],
      result: null,
      error: null,
      notices: [],
      timingMs: 1,
    };
    useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration());
    render(<EditorPane />);
    await act(async () => undefined);
    expect(useBoardStore.getState().expandedTables).toEqual(['public.book']);
    act(() => useSceneStore.getState().close());
    await act(async () => undefined);
    expect(useBoardStore.getState().expandedTables).toEqual([]);
  });
});

describe('EditorPane: глобальные ⌘Z и ⌘⏎', () => {
  const setup = () => {
    const sandbox = {
      undo: vi.fn(async () => undefined),
      apply: vi.fn(async () => []),
      preview: () => new Promise(() => undefined),
      journal: () => [],
      subscribe: () => () => undefined,
    };
    sandboxState.sandbox = sandbox;
    render(
      <>
        <EditorPane />
        <input aria-label="чужое поле" />
        <div role="dialog">
          <button type="button">в диалоге</button>
        </div>
      </>,
    );
    return sandbox;
  };

  it('⌘⏎ с INSERT фокусирует целевую таблицу после применения', async () => {
    const sandbox = setup();
    act(() => {
      useEditorStore.getState().setText("insert into author (name) values ('Ада')");
      useEditorStore.getState().setCursor(40);
    });
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual([]);
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    expect(sandbox.apply).toHaveBeenCalledTimes(1);
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
  });

  it('⌘Z вне полей ввода отменяет применённый запрос', () => {
    const sandbox = setup();
    fireEvent.keyDown(document.body, { code: 'KeyZ', metaKey: true });
    expect(sandbox.undo).toHaveBeenCalledTimes(1);
  });

  it('⌘Z и ⌘⏎ в чужом поле ввода и внутри диалога не трогают песочницу', async () => {
    const sandbox = setup();
    act(() => useEditorStore.getState().setText('select 1'));
    const input = document.querySelector('input') as HTMLInputElement;
    const inDialog = document.querySelector('[role=dialog] button') as HTMLButtonElement;
    for (const target of [input, inDialog]) {
      fireEvent.keyDown(target, { code: 'KeyZ', metaKey: true });
      fireEvent.keyDown(target, { code: 'Enter', ctrlKey: true });
    }
    await act(async () => undefined);
    expect(sandbox.undo).not.toHaveBeenCalled();
    expect(sandbox.apply).not.toHaveBeenCalled();
  });
});
