import { act, render, screen, within } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from '@xyflow/react';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TableInfo } from '@/features/db/introspect';
import { useBoardStore } from '@/stores/board';
import { author, book, cart, category } from './__fixtures__/schema';
import type { TableFlowNode } from './model';
import { columnTitle, TableNode } from './TableNode';

function node(table: TableInfo, onRender: () => void = () => undefined) {
  const props = { id: table.id, data: { table }, type: 'table' } as unknown as NodeProps<TableFlowNode>;
  return (
    <Profiler id={table.id} onRender={onRender}>
      <TableNode {...props} />
    </Profiler>
  );
}

describe('TableNode', () => {
  beforeEach(() => useBoardStore.setState(useBoardStore.getInitialState(), true));

  it('шапка: схема.таблица и число строк', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(within(el).getByText('public.book')).toBeInTheDocument();
    expect(within(el).getByTestId('row-count')).toHaveTextContent('11');
  });

  it('колонки: тип, иконки PK и FK, флаги, тултип с DEFAULT и CHECK', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(within(el).getByLabelText('Первичный ключ')).toBeInTheDocument();
    expect(within(el).getAllByLabelText('Внешний ключ')).toHaveLength(2);
    expect(within(el).getByText('numeric(10,2)')).toBeInTheDocument();
    const title = el.querySelector('[data-column="title"]');
    expect(title && within(title as HTMLElement).getByText('NN')).toBeInTheDocument();
    expect(el.querySelector('[data-column="published_at"]')?.getAttribute('title')).toContain(
      'DEFAULT CURRENT_DATE',
    );
    expect(el.querySelector('[data-column="price"]')?.getAttribute('title')).toContain(
      'CHECK ((price >= (0)::numeric))',
    );
  });

  it('NULL и пустая строка выглядят по-разному, дата без времени', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    const nulls = within(el).getAllByText('NULL');
    expect(nulls.length).toBe(4);
    for (const n of nulls) expect(n).toHaveAttribute('data-kind', 'null');
    expect(within(el).getByText("''")).toHaveAttribute('data-kind', 'empty');
    expect(within(el).getByText('1940-01-01')).toBeInTheDocument();
  });

  it('«+ ещё N» и «пусто»', () => {
    render(
      <ReactFlowProvider>
        {node(book)}
        {node(cart)}
      </ReactFlowProvider>,
    );
    expect(screen.getByText('+ ещё 8')).toBeInTheDocument();
    expect(within(screen.getByTestId('table-node-shop.cart')).getByText('пусто')).toBeInTheDocument();
  });

  it('фокус перерисовывает только свою таблицу', () => {
    const renders = { book: 0, author: 0 };
    render(
      <ReactFlowProvider>
        {node(book, () => renders.book++)}
        {node(author, () => renders.author++)}
      </ReactFlowProvider>,
    );
    const before = { ...renders };
    act(() => useBoardStore.getState().focus(['public.author']));
    expect(renders.book).toBe(before.book);
    expect(renders.author).toBe(before.author + 1);
    expect(screen.getByTestId('table-node-public.author')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('table-node-public.book')).not.toHaveAttribute('data-focused');
  });

  it('подсветка колонок только своей таблицы', () => {
    render(
      <ReactFlowProvider>
        {node(book)}
        {node(author)}
      </ReactFlowProvider>,
    );
    act(() => useBoardStore.getState().highlightColumns(['public.book.title', 'public.author.name']));
    const bookEl = screen.getByTestId('table-node-public.book');
    expect(bookEl.querySelector('[data-column="title"]')).toHaveAttribute('data-highlighted', 'true');
    expect(bookEl.querySelector('[data-column="price"]')).not.toHaveAttribute('data-highlighted');
    expect(
      screen.getByTestId('table-node-public.author').querySelector('[data-column="name"]'),
    ).toHaveAttribute('data-highlighted', 'true');
  });
});

describe('TableNode: акцент touched', () => {
  beforeEach(() => useBoardStore.setState(useBoardStore.getInitialState(), true));

  it('фокус и подсветка колонок используют touched', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    act(() => {
      useBoardStore.getState().focus(['public.book']);
      useBoardStore.getState().highlightColumns(['public.book.title']);
    });
    const el = screen.getByTestId('table-node-public.book');
    expect(el.className).toContain('ring-touched');
    const head = el.querySelector('[data-column="title"]');
    expect(head?.className).toContain('bg-touched/15');
    const cell = el.querySelector('.bg-touched\\/10');
    expect(cell).not.toBeNull();
    expect(el.innerHTML).not.toMatch(/primary/);
  });
});

describe('TableNode: читаемость', () => {
  it('мета колонки и NULL-плашка 11px, не 10px', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    const meta = el.querySelector('.vs-col-meta');
    expect(meta?.className).toContain('text-[11px]');
    expect(el.querySelector('[data-kind="null"]')?.className).toContain('text-[11px]');
    expect(el.innerHTML).not.toContain('text-[10px]');
  });

  it('классы для семантического зума: таблица, строки, мета', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(el.className).toContain('vs-table');
    expect(el.querySelectorAll('.vs-rows').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.vs-col-meta')).toHaveLength(book.columns.length);
  });
});

describe('TableNode: доступность', () => {
  it('корень ноды: подпись с числом строк и всеми колонками', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(el).toHaveAttribute(
      'aria-label',
      `Таблица public.book, 11 строк, колонки: ${book.columns.map((c) => c.name).join(', ')}`,
    );
  });

  it('флаг NN расшифрован через abbr', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    const flag = el.querySelector('[data-column="title"]')?.querySelector('abbr');
    expect(flag).toHaveTextContent('NN');
    expect(flag).toHaveAttribute('title', 'NOT NULL');
  });

  it('флаги U и CHECK тоже расшифрованы', () => {
    render(
      <ReactFlowProvider>
        {node(category)}
        {node(book)}
      </ReactFlowProvider>,
    );
    const unique = screen
      .getByTestId('table-node-public.book_category')
      .querySelector('[data-column="name"] abbr[title="UNIQUE"]');
    expect(unique).toHaveTextContent('U');
    const check = screen.getByTestId('table-node-public.book').querySelector('[data-column="price"] abbr');
    expect(check).toHaveAttribute('title', 'CHECK');
  });
});

describe('columnTitle', () => {
  it('собирает ограничения колонки', () => {
    const [id] = author.columns;
    expect(id && columnTitle(id)).toBe(
      'author_id: bigint\nPRIMARY KEY\nNOT NULL\nGENERATED ALWAYS AS IDENTITY',
    );
  });
});
