import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { Scene, Step, sqlOf } from './Scene';

const Q = [
  'select * from book;',
  'select * from book where price is not null;',
  'select title from book where price is not null;',
];

function block(sql: string) {
  return (
    <pre data-lang="sql" data-meta="run expect=rows:11" data-code={sql}>
      <code>{sql}</code>
    </pre>
  );
}

function renderScene(count = 3) {
  const element = (
    <Scene>
      <Step caption="Берём книги">{block(Q[0] ?? '')}</Step>
      {'\n'}
      <Step caption="Убираем книги без цены">{block(Q[1] ?? '')}</Step>
      {count > 2 && <Step caption="Оставляем только название">{block(Q[2] ?? '')}</Step>}
    </Scene>
  );
  const router = createMemoryRouter([{ path: '/l/:lessonId', element }], {
    initialEntries: ['/l/logical-order'],
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  useEditorStore.setState({ text: '', cursor: 0 });
  useLessonStore.setState({ byId: {} });
});

describe('Scene', () => {
  it('sqlOf находит data-code в глубине', () => {
    expect(sqlOf(<div>{block('select 1;')}</div>)).toBe('select 1;');
    expect(sqlOf(<p>текст</p>)).toBeNull();
  });

  it('показывает первый шаг, «Назад» выключена', () => {
    renderScene();
    expect(screen.getByText('Шаг 1 из 3')).toBeInTheDocument();
    expect(screen.getByText('Берём книги')).toBeInTheDocument();
    expect(screen.queryByText('Убираем книги без цены')).toBeNull();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled();
  });

  it('«Дальше» показывает шаг и отправляет его запрос на доску', () => {
    renderScene();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.getByText('Шаг 2 из 3')).toBeInTheDocument();
    expect(screen.getByText('Убираем книги без цены')).toBeInTheDocument();
    expect(useEditorStore.getState().text).toBe(Q[1]);
    expect(useLessonStore.getState().byId['logical-order']?.ranExample).toBe(true);
  });

  it('на последнем шаге «Дальше» выключена, «Назад» возвращает', () => {
    renderScene();
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(screen.getByRole('button', { name: 'Дальше' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Шаг 2 из 3')).toBeInTheDocument();
    expect(useEditorStore.getState().text).toBe(Q[1]);
  });

  it('на крайнем шаге фокус переходит на вторую кнопку, а не теряется', () => {
    renderScene();
    const next = screen.getByRole('button', { name: 'Дальше' });
    next.focus();
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: 'Назад' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: 'Дальше' })).toHaveFocus();
  });

  it('в сцене из двух шагов фокус тоже не теряется', () => {
    renderScene(2);
    const next = screen.getByRole('button', { name: 'Дальше' });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: 'Назад' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: 'Дальше' })).toHaveFocus();
  });
});
