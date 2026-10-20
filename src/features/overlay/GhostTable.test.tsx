import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GhostTableView } from './GhostTable';
import { ghostWidth, marksWidth } from './geometry';
import type { GhostTable } from './types';

const table: GhostTable = {
  id: 't:b',
  title: 'book b',
  x: 10,
  y: 20,
  columns: [
    { name: 'title', state: 'normal' },
    { name: 'price', state: 'removed' },
  ],
  rows: [
    { key: 'b=(0,1)', values: ['Тихий Дон', '890.00'], state: 'kept' },
    { key: 'b=(0,3)', values: ['Судьба человека', '350.00'], state: 'dropped' },
    { key: 'b=(0,5)', values: ['Судьба человека', '350.00'], state: 'normal' },
    { key: 'b=(0,7)', values: ['Остров', null], state: 'unknown', badge: 'UNKNOWN' },
    { key: 'b=(0,9)', values: ['', '1.00'], state: 'normal' },
  ],
  hiddenRows: 42,
};

describe('GhostTableView', () => {
  it('рисует заголовок, колонки и строки', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByTestId('ghost-table').getAttribute('data-table-id')).toBe('t:b');
    expect(screen.getByText('book b')).toBeTruthy();
    expect(screen.getAllByTestId('ghost-row')).toHaveLength(5);
  });

  it('дубликаты значений рендерятся отдельными строками', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getAllByText('Судьба человека')).toHaveLength(2);
  });

  it('состояния строк в data-state, отсеянные зачёркнуты и с иконкой', () => {
    render(<GhostTableView table={table} />);
    const dropped = screen
      .getAllByTestId('ghost-row')
      .find((r) => r.getAttribute('data-row-key') === 'b=(0,3)');
    expect(dropped?.getAttribute('data-state')).toBe('dropped');
    expect(dropped?.className).toContain('vs-row--dropped');
    expect(dropped?.querySelector('[aria-label="отсеяна"]')).toBeTruthy();
  });

  it('NULL отличается от пустой строки', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('NULL').className).toContain('vs-null');
    expect(screen.getByText("''").className).not.toContain('vs-null');
  });

  it('бейдж и полоса скрытых строк', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('UNKNOWN')).toBeTruthy();
    expect(screen.getByTestId('ghost-hidden').textContent).toBe('… ещё 42 строк');
  });

  it('отрезанные строки гаснут, UNKNOWN полупрозрачные: inline opacity motion не перебивает', () => {
    const cut: GhostTable = {
      ...table,
      rows: [
        { key: 'c', values: ['a', '1'], state: 'cut' },
        { key: 'u', values: ['b', null], state: 'unknown' },
      ],
    };
    render(<GhostTableView table={cut} />);
    const [c, u] = screen.getAllByTestId('ghost-row');
    expect(c.style.opacity).toBe('0.35');
    expect(u.style.opacity).toBe('0.8');
  });

  it('убираемая колонка помечена классом', () => {
    render(<GhostTableView table={table} />);
    expect(screen.getByText('price').className).toContain('vs-col--removed');
  });

  it('свёрнутые колонки: заглушка «+N колонки» в шапке, как у ноды', () => {
    render(<GhostTableView table={{ ...table, foldedColumns: 4 }} />);
    expect(screen.getByTestId('ghost-folded').textContent).toBe('+4 колонки');
  });

  it('одна колонка тянется на всю ширину призрака: справа нет пустой «второй колонки»', () => {
    const one: GhostTable = {
      ...table,
      columns: [{ name: 'count', state: 'highlight' }],
      rows: [{ key: 'g', values: [11], state: 'dropped' }],
      hiddenRows: 0,
    };
    render(<GhostTableView table={one} />);
    const width = `${ghostWidth(one) - marksWidth(one)}px`;
    expect(screen.getByText('count').style.width).toBe(width);
    expect(screen.getByText('11').style.width).toBe(width);
  });
});
