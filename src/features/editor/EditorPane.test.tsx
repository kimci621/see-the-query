import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA } from '@/features/editor/__fixtures__/schema';
import { initParser } from '@/features/sql/parser';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { EditorPane } from './EditorPane';

// CodeMirror в этом тесте не нужен: проверяем эффекты связи, редактор подменён
vi.mock('./SqlEditor', () => ({ SqlEditor: () => null }));
vi.mock('@/features/db/SandboxProvider', () => ({
  useSandbox: () => ({ sandbox: null, status: 'ready', version: null }),
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ lessonId: null }),
}));

beforeEach(async () => {
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

  it('hoveredColumn подсвечивает колонку, уход с hover возвращает подсветку трейса', async () => {
    const trace = {
      sql: 'select title from book',
      statementType: 'select' as const,
      mode: 'final-only' as const,
      touched: { tableIds: ['public.book'], columns: ['public.book.title'] },
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
});
