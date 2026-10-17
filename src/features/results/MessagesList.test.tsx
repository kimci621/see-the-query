import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA } from '@/features/editor/__fixtures__/schema';
import * as explain from '@/features/errors/explain';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { MessagesList } from './MessagesList';
import { ResultsPanel } from './ResultsPanel';

const traceWith = (error: Trace['error']): Trace => ({
  sql: 'select nme from book',
  statementType: 'select',
  mode: 'final-only',
  touched: { tableIds: ['public.book'], columns: [] },
  stages: [],
  result: null,
  error,
  notices: ['DROP TABLE создаст скрипт на каскад'],
  timingMs: 3,
});

beforeEach(() => {
  useBoardStore.setState(useBoardStore.getInitialState(), true);
});

afterEach(() => {
  vi.restoreAllMocks();
  useSceneStore.setState({ ...useSceneStore.getInitialState(), generation: 0 }, true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

describe('MessagesList', () => {
  it('ошибка: человеческое объяснение из словаря + оригинальный текст', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const error = { code: '42703', message: 'column "nme" does not exist', position: 8 };
    render(<MessagesList trace={traceWith(error)} />);
    // живую область вешает панель результата (Q.11), у самой карточки role нет
    expect(screen.queryByRole('alert')).toBeNull();
    // оригинал всегда рядом (спека 5.14)
    expect(screen.getByTestId('pg-original')).toHaveTextContent('column "nme" does not exist');
    // объяснение от словаря Ф2: непустые заголовок и текст
    expect(screen.getByTestId('pg-explain-title').textContent).toBeTruthy();
    expect(screen.getByTestId('pg-explain-body').textContent).toBeTruthy();
  });

  it('NOTICE показываются списком', () => {
    render(<MessagesList trace={traceWith(null)} />);
    expect(screen.getByTestId('notice-0')).toHaveTextContent('DROP TABLE создаст скрипт на каскад');
  });

  it('пусто: «Пока сообщений нет»', () => {
    render(<MessagesList trace={{ ...traceWith(null), notices: [] }} />);
    expect(screen.getByTestId('messages-empty')).toBeInTheDocument();
  });

  it('без трейса тоже пусто', () => {
    render(<MessagesList trace={null} />);
    expect(screen.getByTestId('messages-empty')).toBeInTheDocument();
  });

  it('подсказка видна, explainError зовётся один раз на рендер', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const spy = vi.spyOn(explain, 'explainError');
    const error = { code: '42703', message: 'column "titel" does not exist', position: 8 };
    render(<MessagesList trace={{ ...traceWith(error), sql: 'select titel from book' }} />);
    expect(screen.getByText('Может, title?')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('кнопка «Заменить на title» правит текст редактора', async () => {
    useBoardStore.getState().setSchema(SCHEMA);
    useEditorStore.getState().setText('select titel from book');
    const error = { code: '42703', message: 'column "titel" does not exist', position: 8 };
    render(<MessagesList trace={{ ...traceWith(error), sql: 'select titel from book' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Заменить на title' }));
    expect(useEditorStore.getState().text).toBe('select title from book');
  });
});

describe('ResultsPanel: ошибка', () => {
  it('ошибка трейса видна во вкладке «Результат», без отсылки к «Сообщениям»', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const error = { code: '42703', message: 'column "nme" does not exist', position: 8 };
    useSceneStore.setState({ trace: traceWith(error) });
    render(<ResultsPanel />);
    expect(screen.getByTestId('pg-error')).toBeInTheDocument();
    expect(screen.queryByText(/см\. «Сообщения»/)).toBeNull();
  });

  it('stale + ошибка разбора: карточка 42601, старой ошибки нет', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const old = { code: '42703', message: 'column "nme" does not exist', position: 8 };
    useSceneStore.setState({ trace: traceWith(old), stale: true });
    useEditorStore.setState({
      text: 'select from',
      parseError: { message: 'syntax error at end of input', position: 11 },
    });
    render(<ResultsPanel />);
    expect(screen.getByTestId('pg-error')).toHaveTextContent('42601');
    expect(screen.getByTestId('pg-original')).toHaveTextContent('syntax error at end of input');
    expect(screen.queryByText(/nme/)).toBeNull();
  });
});

describe('ResultsPanel: live-регион', () => {
  const ok = (rows: number): Trace => ({
    ...traceWith(null),
    result: {
      fields: [{ name: 'n', dataTypeID: 23 }],
      rows: Array.from({ length: rows }, (_, i) => [i]),
      command: 'SELECT',
    },
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('вежливый sr-only регион, текст появляется через 1000 мс', () => {
    useSceneStore.setState({ trace: ok(11) });
    render(<ResultsPanel />);
    const live = screen.getByTestId('results-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.className).toContain('sr-only');
    expect(live).toHaveTextContent('');
    act(() => vi.advanceTimersByTime(999));
    expect(live).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(live).toHaveTextContent('11 строк');
  });

  it('ошибка: «Ошибка: » + заголовок объяснения', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const error = { code: '42703', message: 'column "nme" does not exist', position: 8 };
    const title = explain.explainError(error, { sql: 'select nme from book', schema: SCHEMA }).title;
    useSceneStore.setState({ trace: traceWith(error) });
    render(<ResultsPanel />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('results-live')).toHaveTextContent(`Ошибка: ${title}`);
  });

  it('ошибка разбора при stale объявляется так же', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    useSceneStore.setState({ trace: ok(3), stale: true });
    useEditorStore.setState({
      text: 'select from',
      parseError: { message: 'syntax error at end of input', position: 11 },
    });
    render(<ResultsPanel />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('results-live').textContent).toMatch(/^Ошибка: .+/);
  });

  it('быстрые смены результата объявляются один раз, последним', () => {
    useSceneStore.setState({ trace: ok(1) });
    render(<ResultsPanel />);
    act(() => vi.advanceTimersByTime(500));
    act(() => useSceneStore.setState({ trace: ok(5) }));
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByTestId('results-live')).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('results-live')).toHaveTextContent('5 строк');
  });
});
