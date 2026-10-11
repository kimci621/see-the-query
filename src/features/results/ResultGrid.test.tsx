import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '@/features/db/types';
import { ResultGrid } from './ResultGrid';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const size = estimateSize();
    return {
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

  it('пустой результат показывает подсказку', () => {
    const empty: QueryResult = { fields: [{ name: 'x', dataTypeID: 25 }], rows: [] };
    render(<ResultGrid result={empty} emptyHint="0 строк: WHERE отсек всё" />);
    expect(screen.getByTestId('result-empty')).toHaveTextContent('0 строк: WHERE отсек всё');
  });
});
