import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useBoardStore } from '@/stores/board';
import { SCHEMA } from './__fixtures__/schema';
import { BoardStatus, pgVersionLabel } from './BoardStatus';

const VERSION = 'PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten, compiled by emcc';

describe('pgVersionLabel', () => {
  it('достаёт номер версии', () => {
    expect(pgVersionLabel(VERSION)).toBe('PostgreSQL 18.3 в браузере');
    expect(pgVersionLabel(null)).toBeNull();
    expect(pgVersionLabel('что-то другое')).toBeNull();
  });
});

describe('BoardStatus', () => {
  beforeEach(() => useBoardStore.setState(useBoardStore.getInitialState(), true));

  it('пока Postgres поднимается, виден скелетон', () => {
    render(<BoardStatus status="booting" version={null} />);
    expect(screen.getByTestId('board-skeleton')).toHaveTextContent('Поднимаем Postgres...');
    expect(screen.queryByTestId('pg-version')).toBeNull();
  });

  it('готово и таблицы есть: только версия', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    render(<BoardStatus status="ready" version={VERSION} />);
    expect(screen.queryByTestId('board-skeleton')).toBeNull();
    expect(screen.queryByTestId('board-empty')).toBeNull();
    expect(screen.getByTestId('pg-version')).toHaveTextContent('PostgreSQL 18.3 в браузере');
  });

  it('пустая схема: подсказка создать таблицу', () => {
    useBoardStore.getState().setSchema({ schemas: ['public'], tables: [], fks: [], sequences: [] });
    render(<BoardStatus status="ready" version={VERSION} />);
    expect(screen.getByTestId('board-empty')).toHaveTextContent('Создай первую таблицу: create table ...');
  });

  it('фильтр урока скрыл всё: тоже пусто', () => {
    useBoardStore.getState().setSchema(SCHEMA);
    useBoardStore.getState().setVisibleTables(['public.nope']);
    render(<BoardStatus status="ready" version={VERSION} />);
    expect(screen.getByTestId('board-empty')).toBeInTheDocument();
  });

  it('сбой песочницы', () => {
    render(<BoardStatus status="failed" version={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Postgres не запустился');
  });
});
