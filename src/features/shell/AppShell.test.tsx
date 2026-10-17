import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/router';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';

beforeEach(() => useSettingsStore.setState({ focusMode: false }));
afterEach(() => vi.restoreAllMocks());

// Подменяет matchMedia: запрос считается совпавшим, если его текст есть в списке
function mockMedia(matching: string[]) {
  const real = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const mql = real.call(window, query);
    return Object.assign(mql, { matches: matching.includes(query) });
  });
}

// Как mockMedia, но список совпадений можно менять на лету: слушатели change получают событие
function mockResizableMedia(initial: string[]) {
  let matching = initial;
  const listeners = new Set<{ query: string; fn: () => void }>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return matching.includes(query);
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add({ query, fn }),
        removeEventListener: (_: string, fn: () => void) => {
          for (const l of listeners) if (l.fn === fn) listeners.delete(l);
        },
      }) as unknown as MediaQueryList,
  );
  return (next: string[]) =>
    act(() => {
      const prev = matching;
      matching = next;
      // слушатель получает событие только по запросу, чей результат изменился
      for (const { query, fn } of listeners) if (prev.includes(query) !== next.includes(query)) fn();
    });
}

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  it('корень оболочки это main, заголовок вкладки по уроку', async () => {
    renderAt('/l/select-basics');
    expect(await screen.findByRole('main')).toBeInTheDocument();
    expect(document.title).toBe('SELECT: колонки, выражения, алиасы · see-the-query');
  });

  it('заголовок вкладки без урока: имя продукта', async () => {
    renderAt('/l/nope');
    await screen.findByText('Урок не найден');
    expect(document.title).toBe('see-the-query');
  });

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

  it('⌘\\ прячет теорию и возвращает её обратно', async () => {
    renderAt('/l/how-to-use');
    await screen.findByText(/Заглушка урока/);
    // userEvent.keyboard не проставляет code: 'Backslash', поэтому keyDown вручную
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(screen.queryByText(/Заглушка урока/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(await screen.findByText(/Заглушка урока/)).toBeInTheDocument();
  });

  it('ниже 1024px панели сайдбара нет, уроки открываются в Sheet', async () => {
    mockMedia(['(max-width: 1023px)']);
    const user = userEvent.setup();
    const { container } = render(
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/l/how-to-use'] })} />,
    );
    await screen.findByText(/Заглушка урока/);
    expect(container.querySelector('[id="sidebar"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Уроки' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уроки' });
    expect(within(dialog).getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
  });

  it('переход по ссылке урока закрывает Sheet', async () => {
    mockMedia(['(max-width: 1023px)']);
    const user = userEvent.setup();
    const router = renderAt('/l/how-to-use');
    await screen.findByText(/Заглушка урока/);
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уроки' });
    // глава с целевым уроком свёрнута: раскрываем
    await user.click(within(dialog).getByRole('button', { name: /^4\./ }));
    await user.click(within(dialog).getByRole('link', { name: /SELECT: колонки, выражения, алиасы/ }));
    expect(router.state.location.pathname).toBe('/l/select-basics');
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('Sheet не открывается сам после перехода узкий -> широкий -> узкий', async () => {
    const NARROW = '(max-width: 1023px)';
    const resize = mockResizableMedia([NARROW]);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    await screen.findByText(/Заглушка урока/);
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    await screen.findByRole('dialog', { name: 'Уроки' });
    resize([]);
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
    resize([NARROW]);
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('поиск из Sheet: Sheet закрывается, фокус в поле поиска', async () => {
    mockMedia(['(max-width: 1023px)']);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    await screen.findByText(/Заглушка урока/);
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const sheet = await screen.findByRole('dialog', { name: 'Уроки' });
    await user.click(within(sheet).getByRole('button', { name: /Поиск/ }));
    const input = await screen.findByPlaceholderText(/Урок, тема/);
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('на широком экране сайдбар на месте, кнопки «Уроки» нет', async () => {
    renderAt('/l/how-to-use');
    await screen.findByText(/Заглушка урока/);
    expect(screen.getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('ниже 640px заглушка, «Всё равно открыть» её убирает', async () => {
    mockMedia(['(max-width: 1023px)', '(max-width: 639px)']);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    expect(await screen.findByText('see-the-query рассчитан на экран от 1024 px')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Всё равно открыть' }));
    expect(screen.queryByText('see-the-query рассчитан на экран от 1024 px')).not.toBeInTheDocument();
    expect(await screen.findByText(/Заглушка урока/)).toBeInTheDocument();
  });
});
