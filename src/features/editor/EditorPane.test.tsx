import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { col, table } from '@/features/board/__fixtures__/schema';
import type { QueryResult } from '@/features/db/types';
import { SCHEMA } from '@/features/editor/__fixtures__/schema';
import { initParser } from '@/features/sql/parser';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { useSceneStore } from '@/stores/scene';
import { EditorPane } from './EditorPane';

// CodeMirror в этом тесте не нужен: проверяем эффекты связи, редактор подменён
vi.mock('./SqlEditor', () => ({ SqlEditor: () => null }));
const sandboxState = vi.hoisted(() => ({ sandbox: null as unknown }));
const route = vi.hoisted(() => ({ lessonId: null as string | null }));
vi.mock('@/features/db/SandboxProvider', () => ({
  useSandbox: () => ({ sandbox: sandboxState.sandbox, status: 'ready', version: null }),
}));
// Объект стабильный, как в настоящем реестре: иначе эффект открытия урока срабатывал бы на каждый рендер
const WITH_INITIAL = { id: 'with-initial', initialQuery: 'select * from book;' };
vi.mock('@/features/lessons/registry', () => ({
  getLesson: (id: string) => (id === 'with-initial' ? WITH_INITIAL : undefined),
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ lessonId: route.lessonId }),
}));

beforeEach(async () => {
  sandboxState.sandbox = null;
  route.lessonId = null;
  useLessonStore.setState({ byId: {} });
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

  it('трейс DML не перебивает фокус по курсору в USING', async () => {
    const sql = 'delete from author using book where book.author_id = author.id';
    render(<EditorPane />);
    act(() => {
      useEditorStore.getState().setText(sql);
      useEditorStore.getState().setCursor(26); // внутри 'book' в USING
    });
    await act(async () => undefined);
    expect(useEditorStore.getState().activeClause).toBe('using');
    expect(useBoardStore.getState().focused.toSorted()).toEqual(['public.author', 'public.book']);
    act(() =>
      useSceneStore.getState().setTrace(traceOf(sql, 'delete'), useSceneStore.getState().nextGeneration()),
    );
    await act(async () => undefined);
    expect(useBoardStore.getState().focused.toSorted()).toEqual(['public.author', 'public.book']);
  });

  it('трейс SELECT с другим набором таблиц переводит фокус и камеру, с тем же - камеру не дёргает (P8.12)', async () => {
    render(<EditorPane />);
    act(() => useBoardStore.getState().focus(['public.author']));
    const requests = useBoardStore.getState().focusRequest;
    const trace = {
      ...traceOf('select * from book', 'select'),
      touched: { tableIds: ['public.book'], columns: [], expanded: [] },
    };
    act(() => useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration()));
    await act(async () => undefined);
    expect(useBoardStore.getState()).toMatchObject({ focused: ['public.book'], focusRequest: requests + 1 });
    act(() => useSceneStore.getState().setTrace({ ...trace }, useSceneStore.getState().nextGeneration()));
    await act(async () => undefined);
    expect(useBoardStore.getState().focusRequest).toBe(requests + 1);
  });

  it('каретка в конце имени таблицы во FROM фокусирует её до трейса (P8.12)', async () => {
    render(<EditorPane />);
    act(() => {
      useEditorStore.getState().setText('select name from author');
      useEditorStore.getState().setCursor(23);
    });
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

  it('hover меняет подсветку, но не свёртку: колонки свёртки остаются колонками трейса', async () => {
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
    // свёрнутая колонка от hover не разворачивается: ширина ноды и камера не дёргаются
    expect(board.queryColumns).toEqual(['public.book.title', 'public.book.price']);
    act(() => useEditorStore.getState().setHoveredColumn(null));
    await act(async () => undefined);
    expect(useBoardStore.getState().queryColumns).toEqual(['public.book.title', 'public.book.price']);
  });

  it('открытие урока: initialQuery, а при возврате lastQuery важнее initialQuery', () => {
    route.lessonId = 'with-initial';
    const { unmount } = render(<EditorPane />);
    expect(useEditorStore.getState().text).toBe('select * from book;');
    unmount();
    useLessonStore.getState().setLastQuery('with-initial', 'select 1;');
    render(<EditorPane />);
    expect(useEditorStore.getState().text).toBe('select 1;');
  });

  it('lastQuery не хранит текст, равный initialQuery, и стирает прежний', () => {
    vi.useFakeTimers();
    try {
      route.lessonId = 'with-initial';
      useLessonStore.getState().setLastQuery('with-initial', 'select 1;');
      render(<EditorPane />);
      // открылся initialQuery: старый lastQuery на открытие ещё влияет, поэтому правим текст вручную
      act(() => useEditorStore.getState().setText('select * from book;'));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(useLessonStore.getState().byId['with-initial']?.lastQuery).toBeUndefined();
      act(() => useEditorStore.getState().setText('select 2;'));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(useLessonStore.getState().byId['with-initial']?.lastQuery).toBe('select 2;');
    } finally {
      vi.useRealTimers();
    }
  });

  it('открытие урока ничего не меняя не создаёт lastQuery', () => {
    vi.useFakeTimers();
    try {
      route.lessonId = 'with-initial';
      render(<EditorPane />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(useLessonStore.getState().byId['with-initial']?.lastQuery).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('открытие урока ставит стартовый кадр на таблицы стартового текста', async () => {
    route.lessonId = 'unknown';
    useLessonStore
      .getState()
      .setLastQuery('unknown', 'select b.title, a.name from book b join author a using (author_id);');
    render(<EditorPane />);
    await act(async () => undefined);
    const board = useBoardStore.getState();
    expect(board.focused.toSorted()).toEqual(['public.author', 'public.book']);
    expect(board.startRequest).toBe(1);
    expect(board.focusRequest).toBe(0);
  });

  it.each([
    ['без таблиц', 'select 1;'],
    ['не разбирается', 'selec title from book'],
  ])('стартовый текст %s: стартовый кадр на всю доску', async (_, sql) => {
    route.lessonId = 'unknown';
    useLessonStore.getState().setLastQuery('unknown', sql);
    useBoardStore.getState().focus(['public.author']);
    render(<EditorPane />);
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual([]);
    expect(useBoardStore.getState().startRequest).toBe(1);
  });

  it('старт урока ставит свёртку стартового запроса до первого трейса', async () => {
    route.lessonId = 'unknown';
    useLessonStore.getState().setLastQuery('unknown', 'select *, title from book;');
    render(<EditorPane />);
    await act(async () => undefined);
    // звёздочка задействует все поля book
    const book = SCHEMA.tables.find((t) => t.id === 'public.book');
    expect(useBoardStore.getState()).toMatchObject({
      queryColumns: book?.columns.map((c) => `public.book.${c.name}`),
      expandedTables: ['public.book'],
    });
  });

  it('стартовый кадр ждёт схему', async () => {
    route.lessonId = 'unknown';
    useLessonStore.getState().setLastQuery('unknown', 'select title from book');
    useBoardStore.setState({ schema: null });
    render(<EditorPane />);
    await act(async () => undefined);
    expect(useBoardStore.getState().startRequest).toBe(0);
    act(() => useBoardStore.getState().setSchema(SCHEMA));
    await act(async () => undefined);
    expect(useBoardStore.getState()).toMatchObject({ focused: ['public.book'], startRequest: 1 });
    // новая схема после «Применить» стартовый кадр не повторяет
    act(() => useBoardStore.getState().setSchema({ ...SCHEMA }));
    await act(async () => undefined);
    expect(useBoardStore.getState().startRequest).toBe(1);
  });

  it('смена урока: кадр по первой схеме нового урока, а не по схеме прошлого', async () => {
    route.lessonId = 'unknown';
    useLessonStore.getState().setLastQuery('unknown', 'select title from book');
    useBoardStore.setState({
      schema: { ...SCHEMA, tables: SCHEMA.tables.filter((t) => t.id !== 'public.book') },
    });
    const { rerender } = render(<EditorPane />);
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual([]);
    // пересборка базы (useSchemaSync, событие rebuilding) сбрасывает схему, потом приходит схема нового урока
    route.lessonId = 'unknown2';
    useLessonStore.getState().setLastQuery('unknown2', 'select title from book');
    act(() => useBoardStore.getState().setSchema(null));
    rerender(<EditorPane />);
    await act(async () => undefined);
    act(() => useBoardStore.getState().setSchema(SCHEMA));
    await act(async () => undefined);
    expect(useBoardStore.getState().focused).toEqual(['public.book']);
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
      apply: vi.fn(async (_sql: string): Promise<QueryResult[]> => []),
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

  it('⌘⏎ с INSERT возвращает камеру к таблице, даже если она уже в фокусе', async () => {
    const sandbox = setup();
    // фокус на author остался от прошлого применения, а камера ушла за призраком сцены
    act(() => useBoardStore.getState().focus(['public.author']));
    act(() => {
      useEditorStore.getState().setText("insert into author (name) values ('Ада')");
      useEditorStore.getState().setCursor(40);
    });
    await act(async () => undefined);
    const frames = useBoardStore.getState().frameRequest;
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    expect(sandbox.apply).toHaveBeenCalledTimes(1);
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
    expect(useBoardStore.getState().frameRequest).toBe(frames + 1);
  });

  // DDL (P8.59, спека 3.4): камера ждёт новую схему, иначе созданной таблицы на доске ещё нет
  const applyDdl = async (sql: string) => {
    setup();
    act(() => useBoardStore.getState().focus(['public.book']));
    act(() => {
      useEditorStore.getState().setText(sql);
      useEditorStore.getState().setCursor(sql.length);
    });
    await act(async () => undefined);
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    // до новой схемы камера стоит
    expect(useBoardStore.getState().focused).toEqual(['public.book']);
    return useBoardStore.getState();
  };

  it('после «Применить» CREATE TABLE камера летит к новой таблице, когда она пришла в схеме', async () => {
    const before = await applyDdl('create table mine (id int)');
    act(() =>
      useBoardStore
        .getState()
        .setSchema({ ...SCHEMA, tables: [...SCHEMA.tables, table('public.mine', [col('id', 'integer')])] }),
    );
    expect(useBoardStore.getState().focused).toEqual(['public.mine']);
    expect(useBoardStore.getState().frameRequest).toBe(before.frameRequest + 1);
  });

  it('после «Применить» ALTER TABLE камера летит к изменённой таблице', async () => {
    const before = await applyDdl('alter table author add column city text');
    act(() => useBoardStore.getState().setSchema({ ...SCHEMA }));
    expect(useBoardStore.getState().focused).toEqual(['public.author']);
    expect(useBoardStore.getState().frameRequest).toBe(before.frameRequest + 1);
  });

  it('после «Применить» DROP TABLE вписывается вся доска', async () => {
    const before = await applyDdl('drop table author cascade');
    act(() =>
      useBoardStore
        .getState()
        .setSchema({ ...SCHEMA, tables: SCHEMA.tables.filter((t) => t.id !== 'public.author') }),
    );
    expect(useBoardStore.getState().focused).toEqual([]);
    expect(useBoardStore.getState().fitRequest).toBe(before.fitRequest + 1);
  });

  it('пересборка урока после «Применить» DDL кадр не трогает', async () => {
    const before = await applyDdl('create table mine (id int)');
    act(() => useBoardStore.getState().setSchema(null));
    act(() =>
      useBoardStore
        .getState()
        .setSchema({ ...SCHEMA, tables: [...SCHEMA.tables, table('public.mine', [col('id', 'integer')])] }),
    );
    expect(useBoardStore.getState()).toMatchObject({
      focused: ['public.book'],
      frameRequest: before.frameRequest,
    });
  });

  it('повторный ⌘⏎ после применения ничего не применяет, пока текст не изменён (P8.50)', async () => {
    const sandbox = setup();
    const applied: QueryResult = {
      fields: [{ name: 'author_id', dataTypeID: 23 }],
      rows: [[7]],
      command: 'INSERT',
      rowCount: 1,
    };
    sandbox.apply.mockResolvedValue([applied]);
    const insert = "insert into author (name) values ('Ада') returning author_id";
    act(() => {
      useEditorStore.getState().setText(insert);
      useEditorStore.getState().setCursor(insert.length);
    });
    await act(async () => undefined);
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    // панель результата показывает итог применения, а не повтор превью
    const trace = useSceneStore.getState().trace;
    expect(trace?.result).toEqual(applied);
    expect(trace?.sql).toBe(insert);
    expect(trace?.mode).toBe('final-only');

    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    expect(sandbox.apply).toHaveBeenCalledTimes(1);

    // любая правка текста снова разрешает применить
    act(() => useEditorStore.getState().setText(`${insert} `));
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    expect(sandbox.apply).toHaveBeenCalledTimes(2);
  });

  it('правка текста снимает пометки строк на доске (P8.16)', async () => {
    setup();
    act(() => useBoardStore.setState({ rowWrites: [{ since: 750, mark: 'new' }] }));
    act(() => useEditorStore.getState().setText('select 1'));
    await act(async () => undefined);
    expect(useBoardStore.getState().rowWrites).toEqual([]);
  });

  it('SELECT после ⌘⏎ не помечается применённым: сцена превью остаётся', async () => {
    const sandbox = setup();
    act(() => {
      useEditorStore.getState().setText('select 1');
      useEditorStore.getState().setCursor(8);
    });
    fireEvent.keyDown(document.body, { code: 'Enter', metaKey: true });
    await act(async () => undefined);
    expect(sandbox.apply).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().applied).toEqual({});
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
