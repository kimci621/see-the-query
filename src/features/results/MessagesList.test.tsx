import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA } from '@/features/editor/__fixtures__/schema';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { MessagesList } from './MessagesList';

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

describe('MessagesList', () => {
  it('ошибка: человеческое объяснение из словаря + оригинальный текст', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    const error = { code: '42703', message: 'column "nme" does not exist', position: 8 };
    render(<MessagesList trace={traceWith(error)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
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
});
