import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { useBoardStore } from '@/stores/board';
import { C, T } from './TermLinks';

function column(name: string, fk: ColumnInfo['fk'] = null): ColumnInfo {
  return {
    name,
    type: 'bigint',
    nullable: true,
    default: null,
    isPk: false,
    isUnique: false,
    isGenerated: false,
    identity: null,
    checks: [],
    fk,
  };
}

function table(name: string, columns: ColumnInfo[]): TableInfo {
  return {
    id: `public.${name}`,
    schema: 'public',
    name,
    kind: 'table',
    columns,
    rowCount: 0,
    sampleRows: [],
    sampleCtids: [],
    indexes: [],
    comment: null,
  };
}

const schema: SchemaSnapshot = {
  schemas: ['public'],
  tables: [
    table('author', [column('author_id'), column('name')]),
    table('book', [
      column('book_id'),
      column('title'),
      column('author_id', { schema: 'public', table: 'author', column: 'author_id' }),
    ]),
  ],
  fks: [
    {
      name: 'book_author_id_fkey',
      from: { tableId: 'public.book', columns: ['author_id'] },
      to: { tableId: 'public.author', columns: ['author_id'] },
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  sequences: [],
};

beforeEach(() => {
  useBoardStore.getState().setSchema(schema);
  useBoardStore.getState().highlightColumns(['public.author.name']);
  useBoardStore.getState().focus([]);
});

describe('T и C', () => {
  it('наведение на T подсвечивает все колонки таблицы, уход возвращает прежнюю подсветку', () => {
    render(<T id="public.book">book</T>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'book' }));
    expect(useBoardStore.getState().highlightedColumns).toEqual([
      'public.book.book_id',
      'public.book.title',
      'public.book.author_id',
    ]);
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'book' }));
    expect(useBoardStore.getState().highlightedColumns).toEqual(['public.author.name']);
  });

  it('C с внешним ключом подсвечивает обе стороны связи', () => {
    render(<C id="public.book.author_id">book.author_id</C>);
    fireEvent.focus(screen.getByRole('button', { name: 'book.author_id' }));
    expect(useBoardStore.getState().highlightedColumns).toEqual([
      'public.book.author_id',
      'public.author.author_id',
    ]);
  });

  it('повторный вход (фокус, потом мышь) не теряет исходную подсветку', () => {
    render(<C id="public.author.name">name</C>);
    const term = screen.getByRole('button', { name: 'name' });
    useBoardStore.getState().highlightColumns(['public.book.title']);
    fireEvent.focus(term);
    fireEvent.mouseEnter(term);
    fireEvent.mouseLeave(term);
    expect(useBoardStore.getState().highlightedColumns).toEqual(['public.book.title']);
  });

  it('клик фокусирует таблицу', () => {
    render(<C id="public.book.title">title</C>);
    fireEvent.click(screen.getByRole('button', { name: 'title' }));
    expect(useBoardStore.getState().focused).toEqual(['public.book']);
  });

  it('неизвестная таблица ничего не ломает', () => {
    render(<T id="public.ghost">ghost</T>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'ghost' }));
    expect(useBoardStore.getState().highlightedColumns).toEqual([]);
  });
});
