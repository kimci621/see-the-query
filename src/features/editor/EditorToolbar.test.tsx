import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sandbox } from '@/features/db/sandbox';
import type { Trace } from '@/features/tracer/types';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { EditorToolbar } from './EditorToolbar';

// Управляемая готовность парсера: до release() parseSql ведёт себя как настоящий без WASM (ok:false)
const parserState = vi.hoisted(() => ({ ready: true, release: () => {} }));
vi.mock('@/features/sql/parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sql/parser')>();
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

function fakeSandbox(applied: string[]): Sandbox {
  return {
    status: 'ready',
    datasetId: 'bookstore',
    client: vi.fn(),
    loadLesson: vi.fn(),
    preview: vi.fn(),
    apply: async (sql: string) => {
      applied.push(sql);
      return [];
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
      touched: { tableIds: [], columns: [] },
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
    expect(sandbox.reset).toHaveBeenCalledTimes(1);

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
});
