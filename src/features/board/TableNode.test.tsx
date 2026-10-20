import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from '@xyflow/react';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TableInfo } from '@/features/db/introspect';
import { useBoardStore } from '@/stores/board';
import { author, book, cart, category, col, wideBook } from './__fixtures__/schema';
import type { TableFlowNode } from './model';
import { columnTitle, TableNode } from './TableNode';

function node(table: TableInfo, onRender: () => void = () => undefined) {
  const props = { id: table.id, data: { table }, type: 'table' } as unknown as NodeProps<TableFlowNode>;
  return (
    <TooltipProvider>
      <Profiler id={table.id} onRender={onRender}>
        <TableNode {...props} />
      </Profiler>
    </TooltipProvider>
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
  });

  it('шапка колонки в порядке Tab, на фокусе подсказка с ограничениями вместо title', async () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    const head = el.querySelector<HTMLElement>('[data-column="published_at"]');
    expect(head).toHaveAttribute('tabindex', '0');
    expect(head).not.toHaveAttribute('title');
    act(() => head?.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('DEFAULT CURRENT_DATE');
    fireEvent.blur(head as HTMLElement);
    const price = el.querySelector<HTMLElement>('[data-column="price"]');
    act(() => price?.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('CHECK ((price >= (0)::numeric))');
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

describe('TableNode: свёртка широкой таблицы', () => {
  beforeEach(() => useBoardStore.setState(useBoardStore.getInitialState(), true));
  const heads = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-column]')].map((h) => h.getAttribute('data-column'));

  it('заглушка «+N колонки» с именами в тултипе, пустая ячейка в каждой строке', () => {
    const rows = [[1, 'Тихий Дон', 1, 4, '890.00', 1504, null, ['классика'], null]];
    render(<ReactFlowProvider>{node({ ...wideBook, sampleRows: rows, rowCount: 1 })}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(heads(el)).toEqual(['book_id', 'title', 'author_id', 'category_id', 'price']);
    const stub = within(el).getByTestId('hidden-columns');
    expect(stub).toHaveTextContent('+4 колонки');
    expect(el.querySelectorAll('[data-stub-cell]')).toHaveLength(1);
    expect(el.style.width).toBe('756px');
  });

  it('заглушка - кнопка: на фокусе имена свёрнутых колонок, нажатие разворачивает таблицу как select *', async () => {
    useBoardStore.getState().expandTables(['public.author']);
    render(<ReactFlowProvider>{node(wideBook)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    const stub = within(el).getByRole('button', { name: '+4 колонки' });
    expect(stub).toHaveAttribute('data-testid', 'hidden-columns');
    expect(stub).not.toHaveAttribute('title');
    act(() => stub.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('pages, published_at, tags, meta');
    fireEvent.click(stub);
    expect(useBoardStore.getState().expandedTables).toEqual(['public.author', 'public.book']);
    expect(heads(el)).toEqual(wideBook.columns.map((c) => c.name));
    expect(within(el).queryByTestId('hidden-columns')).toBeNull();
  });

  it('склонение: колонка, колонки, колонок', () => {
    const narrow = { ...wideBook, columns: wideBook.columns.slice(0, 7) };
    const { unmount } = render(<ReactFlowProvider>{node(narrow)}</ReactFlowProvider>);
    expect(screen.getByTestId('hidden-columns')).toHaveTextContent('+2 колонки');
    unmount();
    const extra = ['a', 'b', 'c', 'd'].map((n) => col(n, 'int'));
    const wide = { ...wideBook, columns: [...wideBook.columns, ...extra] };
    render(<ReactFlowProvider>{node(wide)}</ReactFlowProvider>);
    expect(screen.getByTestId('hidden-columns')).toHaveTextContent('+8 колонок');
    // затронуты все, кроме последней
    const touched = wide.columns.slice(0, -1).map((c) => `public.book.${c.name}`);
    act(() => useBoardStore.getState().setQueryColumns(touched));
    expect(screen.getByTestId('hidden-columns')).toHaveTextContent('+1 колонка');
  });

  it('затронутая колонка показывается, звёздочка разворачивает целиком', () => {
    render(<ReactFlowProvider>{node(wideBook)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    act(() => useBoardStore.getState().setQueryColumns(['public.book.tags']));
    expect(heads(el)).toContain('tags');
    act(() => useBoardStore.getState().expandTables(['public.book']));
    expect(heads(el)).toEqual(wideBook.columns.map((c) => c.name));
    expect(within(el).queryByTestId('hidden-columns')).toBeNull();
    expect(el.style.width).toBe(`${9 * 132}px`);
  });

  it('свёртку задают колонки запроса, а не подсветка hover', () => {
    render(<ReactFlowProvider>{node(wideBook)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    act(() => {
      useBoardStore
        .getState()
        .setQueryColumns(['public.book.tags', 'public.book.meta', 'public.book.author_id']);
      useBoardStore.getState().highlightColumns(['public.book.author_id']);
    });
    expect(heads(el)).toEqual(expect.arrayContaining(['tags', 'meta', 'author_id']));
    expect(el.querySelector('[data-column="author_id"]')).toHaveAttribute('data-highlighted', 'true');
    expect(el.querySelector('[data-column="tags"]')).not.toHaveAttribute('data-highlighted');
  });

  it('подсвеченная свёрнутая колонка подсвечивает заглушку', () => {
    render(<ReactFlowProvider>{node(wideBook)}</ReactFlowProvider>);
    const stub = screen.getByTestId('hidden-columns');
    expect(stub).not.toHaveAttribute('data-highlighted');
    act(() => useBoardStore.getState().highlightColumns(['public.book.pages']));
    expect(stub).toHaveAttribute('data-highlighted', 'true');
    expect(stub).toHaveClass('bg-touched/10');
    act(() => useBoardStore.getState().highlightColumns(['public.book.title']));
    expect(stub).not.toHaveAttribute('data-highlighted');
  });

  it('разворот другой таблицы эту ноду не перерисовывает', () => {
    const renders = { book: 0 };
    render(<ReactFlowProvider>{node(wideBook, () => renders.book++)}</ReactFlowProvider>);
    const before = renders.book;
    act(() => useBoardStore.getState().expandTables(['public.author']));
    expect(renders.book).toBe(before);
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
    expect(head?.className).toContain('bg-touched/10');
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
  it('подпись ноды живёт на обёртке React Flow, внутренний корень без дубля', () => {
    render(<ReactFlowProvider>{node(book)}</ReactFlowProvider>);
    const el = screen.getByTestId('table-node-public.book');
    expect(el).not.toHaveAttribute('aria-label');
    expect(el).not.toHaveAttribute('role');
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

  it('строки, записанные «Применить», помечены new или changed по xmin (P8.16)', () => {
    const marked = { ...author, sampleXmins: author.sampleRows.map((_, i) => String(745 + i * 5)) };
    // 745 старая; 750 записал INSERT; 755 записал UPDATE
    act(() =>
      useBoardStore.setState({
        rowWrites: [
          { since: 750, mark: 'new' },
          { since: 755, mark: 'changed' },
        ],
      }),
    );
    render(<ReactFlowProvider>{node(marked)}</ReactFlowProvider>);
    const rows = screen.getByTestId('table-node-public.author').querySelectorAll('.vs-rows[data-row]');
    const marks = [...rows].map((r) => r.getAttribute('data-mark'));
    expect(marks).toEqual([null, 'new', 'changed']);
    act(() => useBoardStore.getState().clearRowWrites());
    expect(screen.getByTestId('table-node-public.author').querySelectorAll('[data-mark]')).toHaveLength(0);
  });
});
