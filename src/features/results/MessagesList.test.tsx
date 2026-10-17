import { render, screen } from '@testing-library/react';
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
