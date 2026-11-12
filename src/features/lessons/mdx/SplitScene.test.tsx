import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SplitSceneData } from '@/features/scenes/split';
import { SplitPlayer } from './SplitScene';

const original = {
  title: 'student',
  columns: ['id', 'name', 'hobbies'],
  rows: [
    { key: '0', values: [1, 'Анна', 'шахматы, рисование'] },
    { key: '1', values: [2, 'Борис', 'плавание'] },
  ],
};
const split = {
  title: 'Отдельные значения',
  columns: ['student_id', 'hobby'],
  rows: [
    { key: '0', values: [1, 'шахматы'] },
    { key: '1', values: [1, 'рисование'] },
    { key: '2', values: [2, 'плавание'] },
  ],
};
const data: SplitSceneData = {
  frames: [
    { left: original, right: null, caption: 'Исходные данные' },
    { left: original, right: split, caption: 'Разделение' },
    {
      left: {
        ...original,
        columns: ['id', 'name'],
        rows: original.rows.map((r) => ({ ...r, values: r.values.slice(0, 2) })),
      },
      right: { ...split, title: 'student_hobby' },
      caption: 'Проект таблиц',
    },
  ],
  truncatedParents: false,
  truncatedValues: false,
};

describe('сцена нормализации', () => {
  it('объявляет шаги, показывает реальные связи и сохраняет фокус на краях', () => {
    render(<SplitPlayer data={data} keyColumn="id" />);
    const scene = screen.getByRole('region', { name: 'Разделение таблицы' });
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 1 из 3: Исходные данные');
    const next = screen.getByRole('button', { name: 'Дальше' });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 2 из 3: Разделение');
    expect(screen.getByRole('region', { name: 'Отдельные значения' })).toHaveTextContent('рисование');
    fireEvent.keyDown(scene, { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('Шаг 3 из 3: Проект таблиц');
    expect(screen.getByRole('region', { name: 'student_hobby' })).toHaveTextContent('плавание');
    expect(screen.getByRole('button', { name: 'Назад' })).toHaveFocus();
    fireEvent.keyDown(scene, { key: 'ArrowLeft' });
    fireEvent.keyDown(scene, { key: 'ArrowLeft' });
    expect(next).toHaveFocus();
  });
});
