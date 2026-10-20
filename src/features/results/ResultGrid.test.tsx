import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '@/features/db/types';
import type { Trace } from '@/features/tracer/types';
import { useSceneStore } from '@/stores/scene';
import { ResultGrid } from './ResultGrid';
import { ResultsPanel } from './ResultsPanel';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const size = estimateSize();
    return {
      measureElement: () => undefined,
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({
          index: i,
          key: i,
          start: i * size,
          size,
        })),
    };
  },
}));

const RESULT: QueryResult = {
  fields: [
    { name: 'title', dataTypeID: 25 },
    { name: 'price', dataTypeID: 1700 },
  ],
  rows: [
    ['Тихий Дон', '890.00'],
    ['Остров погибших кораблей', null],
    ['', '0.00'],
  ],
  command: 'SELECT',
  rowCount: 3,
};

describe('ResultGrid', () => {
  it('шапка колонок, строки, NULL и пустая строка различимы', () => {
    render(<ResultGrid result={RESULT} />);
    expect(screen.getByTestId('result-grid')).toBeInTheDocument();
    expect(screen.getByTestId('field-title')).toHaveTextContent('title');
    expect(screen.getByTestId('field-price')).toHaveTextContent('price');
    expect(screen.getAllByTestId('row-0')).toHaveLength(1);
    expect(screen.getByTestId('cell-0-0')).toHaveTextContent('Тихий Дон');
    expect(screen.getByTestId('cell-1-1')).toHaveTextContent('NULL');
    expect(screen.getByTestId('cell-1-1')).toHaveAttribute('data-kind', 'null');
    expect(screen.getByTestId('cell-2-0')).toHaveAttribute('data-kind', 'empty');
  });

  it('колонки с одинаковым именем: обе на месте, без дублей ключа', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const twin: QueryResult = {
      fields: [
        { name: 'count', dataTypeID: 20 },
        { name: 'count', dataTypeID: 20 },
      ],
      rows: [['11', '10']],
      command: 'SELECT',
      rowCount: 1,
    };
    render(<ResultGrid result={twin} />);
    expect(screen.getAllByTestId('field-count')).toHaveLength(2);
    expect(screen.getByTestId('cell-0-0')).toHaveTextContent('11');
    expect(screen.getByTestId('cell-0-1')).toHaveTextContent('10');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('date без времени, как на доске', () => {
    const dated: QueryResult = {
      fields: [{ name: 'published_at', dataTypeID: 1082 }],
      rows: [[new Date('1940-01-01T00:00:00Z')]],
      command: 'SELECT',
      rowCount: 1,
    };
    render(<ResultGrid result={dated} />);
    expect(screen.getByTestId('cell-0-0')).toHaveTextContent(/^1940-01-01$/);
  });

  it('пустой результат показывает подсказку', () => {
    const empty: QueryResult = { fields: [{ name: 'x', dataTypeID: 25 }], rows: [] };
    render(<ResultGrid result={empty} emptyHint="0 строк: WHERE отсек всё" />);
    expect(screen.getByTestId('result-empty')).toHaveTextContent('0 строк: WHERE отсек всё');
  });

  it('шапка лежит внутри контейнера прокрутки', () => {
    render(<ResultGrid result={RESULT} />);
    const scroller = screen.getByRole('table');
    expect(scroller.contains(screen.getByTestId('field-title'))).toBe(true);
    expect(screen.getByTestId('field-title').parentElement).toHaveClass('sticky');
  });

  it('семантика таблицы', () => {
    render(<ResultGrid result={RESULT} />);
    const table = screen.getByRole('table', { name: 'Результат запроса' });
    expect(table).toHaveAttribute('aria-rowcount', String(RESULT.rows.length + 1));
    expect(screen.getAllByRole('columnheader')).toHaveLength(RESULT.fields.length);
    expect(screen.getByTestId('row-0')).toHaveAttribute('aria-rowindex', '2');
    expect(screen.getByTestId('cell-0-0')).toHaveAttribute('role', 'cell');
  });

  it('строки шире панели получают min-width', () => {
    render(<ResultGrid result={RESULT} />);
    const minWidth = `${RESULT.fields.length * 96}px`;
    expect(screen.getByTestId('field-title').parentElement?.style.minWidth).toBe(minWidth);
    expect(screen.getByTestId('row-0').style.minWidth).toBe(minWidth);
  });
});

describe('ResultsPanel', () => {
  const trace = (result: QueryResult): Trace => ({
    sql: '',
    statementType: 'select',
    mode: 'final-only',
    touched: { tableIds: [], columns: [], expanded: [] },
    stages: [],
    result,
    error: null,
    notices: [],
    timingMs: 1,
  });

  it('DML без строк: подсказка про затронутые, не «0 строк»', () => {
    useSceneStore.setState({ trace: trace({ fields: [], rows: [], command: 'INSERT', rowCount: 1 }) });
    render(<ResultsPanel />);
    expect(screen.getByTestId('result-empty')).toHaveTextContent('INSERT не возвращает строк. Затронуто: 1');
  });

  it('DDL: ни «CREATE: 0» в бейдже, ни «Затронуто: 0» в подсказке', () => {
    useSceneStore.setState({ trace: trace({ fields: [], rows: [], command: 'CREATE', rowCount: 0 }) });
    render(<ResultsPanel />);
    expect(screen.getByTestId('result-count')).toHaveTextContent(/^CREATE$/);
    expect(screen.getByTestId('result-empty')).toHaveTextContent(/^CREATE не возвращает строк\.$/);
  });

  it('бейдж счётчика: число и слово', () => {
    const rows = Array.from({ length: 11 }, (_, i) => [i, 'x']);
    useSceneStore.setState({ trace: trace({ ...RESULT, rows, rowCount: 11 }) });
    render(<ResultsPanel />);
    expect(screen.getByTestId('result-count')).toHaveTextContent('11 строк');
  });
});
