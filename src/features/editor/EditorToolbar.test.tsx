import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sandbox } from '@/features/db/sandbox';
import type { QueryResult } from '@/features/db/types';
import type { Trace } from '@/features/tracer/types';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { EditorToolbar } from './EditorToolbar';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Управляемая готовность парсера: до release() parseSql ведёт себя как настоящий без WASM (ok:false)
const parserState = vi.hoisted(() => ({ ready: true, release: () => {} }));
vi.mock('@/features/sql/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sql/parser')>();
  // WASM libpg-query грузится асинхронно с импорта; без ожидания под нагрузкой настоящий parseSql
  // отвечает «WASM module not initialized», операторов 0 и кнопки остаются выключенными
  await actual.initParser();
  return {
    ...actual,
    isParserReady: () => parserState.ready,
    initParser: () =>
      parserState.ready
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            parserState.release = () => {
              parserState.ready = true;
              resolve();
            };
          }),
    parseSql: (text: string) =>
      parserState.ready
        ? actual.parseSql(text)
        : { ok: false as const, error: { message: 'parser not ready', position: 0 } },
  };
});

function fakeSandbox(applied: string[], result: QueryResult[] = []): Sandbox {
  return {
    status: 'ready',
    datasetId: 'bookstore',
    client: vi.fn(),
    loadLesson: vi.fn(),
    preview: vi.fn(),
    apply: async (sql: string) => {
      applied.push(sql);
      return result;
    },
    undo: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    journal: () => (applied.length > 0 ? applied : ['prev']),
    subscribe: () => () => undefined,
  } as unknown as Sandbox;
}

describe('EditorToolbar', () => {
  beforeEach(() => {
    parserState.ready = true;
    vi.clearAllMocks();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useSceneStore.setState({ ...useSceneStore.getInitialState(), generation: 0 }, true);
  });

  it('индикатор превью отражает статус и погашенность', () => {
    useSceneStore.setState({ status: 'tracing' });
    const { rerender } = render(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('preview-status')).toHaveTextContent('Считаем');
    useSceneStore.setState({ status: 'ready', stale: true });
    rerender(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('preview-status')).toHaveTextContent('Недописан');
    useSceneStore.setState({ stale: false });
    rerender(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('preview-status')).toHaveTextContent('Превью');
  });

  it('бейдж: ошибка трейса красная, без ошибки «база не меняется», stale важнее ошибки', () => {
    const trace = {
      sql: 'select nme',
      statementType: 'select',
      mode: 'final-only',
      touched: { tableIds: [], columns: [], expanded: [] },
      stages: [],
      result: null,
      error: { code: '42703', message: 'x' },
      notices: [],
      timingMs: 1,
    } as unknown as Trace;
    useSceneStore.setState({ status: 'ready', trace });
    const { rerender } = render(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    const badge = screen.getByTestId('preview-status');
    expect(badge).toHaveTextContent('Ошибка');
    expect(badge).toHaveClass('text-destructive');
    useSceneStore.setState({ stale: true });
    rerender(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    expect(badge).toHaveTextContent('Недописан');
    expect(badge).not.toHaveClass('text-destructive');
    useSceneStore.setState({ stale: false, trace: { ...trace, error: null } });
    rerender(<EditorToolbar sandbox={null} onApplyCurrent={() => undefined} />);
    expect(badge).toHaveTextContent('Превью: база не меняется');
    expect(badge).not.toHaveClass('text-destructive');
  });

  it('«Применить» вызывает onApplyCurrent (единый путь с ⌘⏎), «Сброс» и «Отменить» зовут песочницу', async () => {
    useEditorStore.getState().setText('select 1');
    const applied: string[] = [];
    const sandbox = fakeSandbox(applied);
    const onApplyCurrent = vi.fn();
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={onApplyCurrent} />);

    await user.click(screen.getByTestId('apply-button'));
    expect(onApplyCurrent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('reset-button'));
    await user.click(await screen.findByRole('button', { name: 'Сбросить' }));
    expect(sandbox.reset).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(screen.queryByText('Сбросить урок?')).toBeNull());
    await user.click(screen.getByTestId('undo-button'));
    expect(sandbox.undo).toHaveBeenCalledTimes(1);
  });

  it('«Применить всё» появляется при двух операторах и применяет каждый', async () => {
    const applied: string[] = [];
    const sandbox = fakeSandbox(applied);
    useEditorStore.getState().setText('select 1; select 2');
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={() => undefined} />);

    const applyAll = screen.getByTestId('apply-all-button');
    await user.click(applyAll);
    expect(applied).toEqual(['select 1', 'select 2']);
  });

  it('при одном операторе кнопки «Применить всё» нет', () => {
    useEditorStore.getState().setText('select 1');
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    expect(screen.queryByTestId('apply-all-button')).toBeNull();
  });

  it('кнопка Применить оживает, когда парсер догрузился', async () => {
    parserState.ready = false;
    useEditorStore.getState().setText('select 1;');
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    const applyButton = screen.getByTestId('apply-button');
    expect(applyButton).toBeDisabled();

    act(() => parserState.release());
    await waitFor(() => expect(applyButton).toBeEnabled());
  });

  it('Применить вторичная для SELECT и основная для INSERT', () => {
    useEditorStore.getState().setText('select 1');
    const { rerender } = render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('apply-button')).toHaveAttribute('data-variant', 'outline');

    const insert = "insert into author(name) values ('x')";
    act(() => {
      useEditorStore.getState().setText(insert);
      useEditorStore.getState().setCursor(insert.length);
    });
    rerender(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('apply-button')).toHaveAttribute('data-variant', 'default');
  });

  it('после применения «Применено» (outline, aria-disabled), правка текста возвращает «Применить»', async () => {
    const insert = "insert into author(name) values ('x')";
    act(() => {
      useEditorStore.getState().setText(insert);
      useEditorStore.getState().setCursor(insert.length);
    });
    const onApplyCurrent = vi.fn(() => useEditorStore.getState().markApplied(0, { sql: insert } as Trace));
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={onApplyCurrent} />);
    const button = screen.getByTestId('apply-button');
    expect(button).toHaveTextContent('Применить');
    expect(button).toHaveAttribute('data-variant', 'default');

    await user.click(button);
    expect(button).toHaveTextContent('Применено');
    expect(button).toHaveAttribute('data-variant', 'outline');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // фокус не теряется: кнопка не disabled
    expect(button).toBeEnabled();

    act(() => useEditorStore.getState().setText(`${insert} returning *`));
    expect(button).toHaveTextContent(/^Применить/);
    expect(button).toHaveAttribute('data-variant', 'default');
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('«Применить всё» помечает пишущие операторы применёнными, SELECT нет', async () => {
    const text = "insert into author(name) values ('x'); select 1";
    act(() => useEditorStore.getState().setText(text));
    const sandbox = fakeSandbox([], [{ command: 'INSERT', rowCount: 1, rows: [], fields: [] }]);
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={() => undefined} />);
    await user.click(screen.getByTestId('apply-all-button'));
    await waitFor(() => expect(Object.keys(useEditorStore.getState().applied)).toEqual(['0']));
  });

  it('«Применить» вторичная, если превью закончилось ошибкой (P8.16)', () => {
    const del = 'delete from author';
    act(() => {
      useEditorStore.getState().setText(del);
      useEditorStore.getState().setCursor(del.length);
    });
    const trace = {
      sql: del,
      statementType: 'delete',
      mode: 'final-only',
      touched: { tableIds: [], columns: [], expanded: [] },
      stages: [],
      result: null,
      error: { code: '23503', message: 'fk' },
      notices: [],
      timingMs: 1,
    } as unknown as Trace;
    useSceneStore.setState({ status: 'ready', trace });
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    expect(screen.getByTestId('apply-button')).toHaveAttribute('data-variant', 'outline');
  });

  it('UPDATE и DELETE без WHERE: плашка предупреждает, сколько строк затронет (P8.16)', () => {
    const traceOf = (sql: string, rowCount: number, kind: string) =>
      ({
        sql,
        statementType: kind,
        mode: 'final-only',
        touched: { tableIds: [], columns: [], expanded: [] },
        stages: [],
        result: { fields: [], rows: [], command: kind.toUpperCase(), rowCount },
        error: null,
        notices: [],
        timingMs: 1,
      }) as unknown as Trace;
    const show = (sql: string, rowCount: number, kind: string) => {
      act(() => {
        useEditorStore.getState().setText(sql);
        useEditorStore.getState().setCursor(sql.length);
        useSceneStore.setState({ status: 'ready', trace: traceOf(sql, rowCount, kind) });
      });
      return screen.getByTestId('preview-status');
    };
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    expect(show('update book set price = 0', 11, 'update')).toHaveTextContent('изменятся все 11 строк');
    expect(show('update book set price = 0', 3, 'update')).toHaveTextContent('изменятся все 3 строки');
    expect(show('delete from author', 6, 'delete')).toHaveTextContent('удалятся все 6 строк');
    expect(show('delete from author', 1, 'delete')).toHaveTextContent('удалится единственная строка');
    expect(show('delete from author', 6, 'delete')).toHaveClass('text-changed');
    // с WHERE, на пустой таблице и для чужой трассы предупреждения нет
    expect(show('update book set price = 0 where book_id = 1', 1, 'update')).not.toHaveTextContent(
      'изменится',
    );
    expect(show('delete from author', 0, 'delete')).not.toHaveTextContent('удал');
    act(() => useEditorStore.getState().setText('delete from author '));
    expect(screen.getByTestId('preview-status')).not.toHaveTextContent('удал');
  });

  it('«Отменить» показывает тост «Отменено: INSERT» на месте тоста записи (P8.16)', async () => {
    const sandbox = fakeSandbox(["insert into author(name) values ('x')"]);
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={() => undefined} />);
    await user.click(screen.getByTestId('undo-button'));
    expect(sandbox.undo).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenLastCalledWith('Отменено: INSERT', { id: 'apply' });
  });

  it('Сброс спрашивает подтверждение', async () => {
    const sandbox = fakeSandbox([]);
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={() => undefined} />);

    await user.click(screen.getByTestId('reset-button'));
    expect(await screen.findByText('Сбросить урок?')).toBeInTheDocument();
    expect(sandbox.reset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(sandbox.reset).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Сбросить урок?')).toBeNull());

    await user.click(screen.getByTestId('reset-button'));
    await user.click(await screen.findByRole('button', { name: 'Сбросить' }));
    expect(sandbox.reset).toHaveBeenCalledTimes(1);
  });

  it('Esc в диалоге сброса возвращает фокус на «Сброс»', async () => {
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={fakeSandbox([])} onApplyCurrent={() => undefined} />);
    await user.click(screen.getByTestId('reset-button'));
    expect(await screen.findByText('Сбросить урок?')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Сбросить урок?')).toBeNull());
    expect(screen.getByTestId('reset-button')).toHaveFocus();
  });

  it('после применения тост с итогом', async () => {
    useEditorStore.getState().setText('select 1; select 2');
    const sandbox = fakeSandbox([], [{ command: 'INSERT', rowCount: 1, rows: [], fields: [] }]);
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={() => undefined} />);

    await user.click(screen.getByTestId('apply-all-button'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Записано в базу', {
        id: 'apply',
        description: 'INSERT: 1 строка',
      }),
    );
  });
});
