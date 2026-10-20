import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Decorations } from './Decorations';
import { ghostWidth, ROW_H, rowTop } from './geometry';
import type { Frame } from './types';

const t = {
  id: 't:b',
  title: 'book',
  x: 0,
  y: 0,
  columns: [{ name: 'author_id', state: 'normal' as const }],
  rows: [{ key: 'b=(0,1)', values: [1], state: 'normal' as const }],
};
const a = { ...t, id: 't:a', x: 400, rows: [{ key: 'a=(0,1)', values: [1], state: 'normal' as const }] };

describe('Decorations', () => {
  it('рисует сканер, ножницы, счётчик и линию пары', () => {
    const frame: Frame = {
      tables: [t, a],
      decorations: [
        { kind: 'scanner', table: 't:b', rowIndex: 0 },
        { kind: 'scissors', table: 't:b', afterRow: 0 },
        { kind: 'counter', id: 'c', x: 10, y: 10, text: '5 → 3' },
        {
          kind: 'pair-line',
          id: 'p',
          from: { table: 't:b', row: 'b=(0,1)', col: 'author_id' },
          to: { table: 't:a', row: 'a=(0,1)', col: 'author_id' },
        },
        { kind: 'bracket', table: 't:b', fromRow: 0, toRow: 0, color: 2, label: 'Россия' },
        { kind: 'arrow', id: 'r', from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, tone: 'danger' },
      ],
    };
    render(<Decorations frame={frame} />);
    expect(screen.getByTestId('deco-scanner')).toBeTruthy();
    expect(screen.getByTestId('deco-scissors')).toBeTruthy();
    expect(screen.getByTestId('deco-counter').textContent).toBe('5 → 3');
    expect(screen.getByTestId('deco-pair-line').getAttribute('d')).toMatch(/^M /);
    expect(screen.getByTestId('deco-bracket').textContent).toBe('Россия');
    expect(screen.getByTestId('deco-arrow')).toBeTruthy();
  });

  it('линия пары идёт между краями таблиц, а не через колонки: ключ первой колонкой слева', () => {
    // author a left join book b: ключ author_id первый в author, справа от него name и country
    const author = {
      ...t,
      id: 't:a',
      columns: ['author_id', 'name', 'country'].map((name) => ({ name, state: 'normal' as const })),
      rows: [{ key: 'a=(0,1)', values: [1, 'Шолохов', 'Россия'], state: 'normal' as const }],
    };
    const book = {
      ...t,
      id: 't:b',
      x: 500,
      rows: [{ key: 'b=(0,1)', values: [1], state: 'normal' as const }],
    };
    const frame: Frame = {
      tables: [author, book],
      decorations: [
        {
          kind: 'pair-line',
          id: 'p',
          from: { table: 't:a', row: 'a=(0,1)', col: 'author_id' },
          to: { table: 't:b', row: 'b=(0,1)', col: 'author_id' },
        },
      ],
    };
    render(<Decorations frame={frame} />);
    const y = rowTop(0) + ROW_H / 2;
    const d = screen.getByTestId('deco-pair-line').getAttribute('d') ?? '';
    expect(d.startsWith(`M ${ghostWidth(author)} ${y} `)).toBe(true);
    expect(d.endsWith(`, 500 ${y}`)).toBe(true);
  });

  it('декорация на несуществующую таблицу пропускается', () => {
    render(
      <Decorations frame={{ tables: [], decorations: [{ kind: 'scanner', table: 'нет', rowIndex: 0 }] }} />,
    );
    expect(screen.queryByTestId('deco-scanner')).toBeNull();
  });
});
