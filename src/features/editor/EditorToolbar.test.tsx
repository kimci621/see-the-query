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

  it('после применения «Применено» (outline, активна), правка текста возвращает «Применить»', async () => {
    // песочница с живым журналом и подпиской, как настоящая
    let journal: string[] = [];
    const listeners = new Set<(e: { type: 'changed' }) => void>();
    const sandbox = {
      ...fakeSandbox([]),
      journal: () => journal,
      subscribe: (l: (e: { type: 'changed' }) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    } as unknown as Sandbox;
    const insert = "insert into author(name) values ('x')";
    act(() => {
      useEditorStore.getState().setText(insert);
      useEditorStore.getState().setCursor(insert.length);
    });
    const onApplyCurrent = vi.fn(() => {
      journal = [...journal, insert];
      for (const l of listeners) l({ type: 'changed' });
    });
    const user = userEvent.setup();
    render(<EditorToolbar sandbox={sandbox} onApplyCurrent={onApplyCurrent} />);
    const button = screen.getByTestId('apply-button');
    expect(button).toHaveTextContent('Применить');
    expect(button).toHaveAttribute('data-variant', 'default');

    await user.click(button);
    expect(button).toHaveTextContent('Применено');
    expect(button).toHaveAttribute('data-variant', 'outline');
    expect(button).toBeEnabled();

    act(() => useEditorStore.getState().setText(`${insert} returning *`));
    expect(button).toHaveTextContent(/^Применить/);
    expect(button).toHaveAttribute('data-variant', 'default');
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
      expect(toast.success).toHaveBeenCalledWith('Записано в базу', { description: 'INSERT: 1 строка' }),
    );
  });
});
