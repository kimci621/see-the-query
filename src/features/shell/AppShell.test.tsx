import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '@/app/router';
import { useLessonStore } from '@/stores/lesson';

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  it('/ уводит на первый урок', async () => {
    const router = renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Как пользоваться доской' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/l/how-to-use');
  });

  it('урок рендерит MDX и навигацию вперёд', async () => {
    renderAt('/l/how-to-use');
    expect(await screen.findByText(/Заглушка урока/)).toBeInTheDocument();
    // Ссылка на урок есть и в левой колонке, поэтому ищем внутри навигации по соседним урокам
    const pager = screen.getByRole('navigation', { name: 'Соседние уроки' });
    expect(within(pager).getByRole('link', { name: /SELECT: колонки, выражения, алиасы/ })).toHaveAttribute(
      'href',
      '/l/select-basics',
    );
  });

  it('открытый урок отмечается посещённым', async () => {
    renderAt('/l/select-basics');
    await screen.findByText(/Заглушка урока/);
    expect(useLessonStore.getState().byId['select-basics']?.visited).toBe(true);
  });

  it('неизвестный урок: «Урок не найден», правая колонка жива', async () => {
    renderAt('/l/nope');
    expect(await screen.findByText('Урок не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /К первому уроку/ })).toHaveAttribute('href', '/l/how-to-use');
    expect(screen.getByRole('region', { name: 'Доска' })).toBeInTheDocument();
  });

  it('правая колонка из четырёх панелей', async () => {
    renderAt('/l/how-to-use');
    for (const name of ['Доска', 'Таймлайн', 'Редактор', 'Результат']) {
      expect(await screen.findByRole('region', { name })).toBeInTheDocument();
    }
  });
});
