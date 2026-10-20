import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/router';
import { LessonView } from '@/features/lessons/LessonView';
import { getLesson, loadLessonContent, neighbours } from '@/features/lessons/registry';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';

// Тело урока - React.lazy поверх import() MDX. Первый показ урока ждёт модуль и троттлинг Suspense
// (React держит скелетон не меньше 300 мс), под нагрузкой это дольше секунды findBy, и тест, первым
// ждущий тело урока, падал (P8.61). LessonView кэширует lazy на урок: прогреваем кэш заранее,
// дальше тело рисуется сразу, без Suspense
beforeAll(async () => {
  for (const id of ['how-to-use', 'select-basics']) {
    const meta = getLesson(id);
    if (!meta) throw new Error(`нет урока ${id}`);
    const { unmount } = render(
      <MemoryRouter>
        <LessonView meta={meta} />
      </MemoryRouter>,
    );
    await loadLessonContent(meta);
    // lazy получает модуль в своём then: ждём, пока отработают все микрозадачи
    await new Promise((resolve) => setTimeout(resolve));
    unmount();
  }
  // прогрев не должен оставить следов: урок отмечен посещённым
  useLessonStore.setState(useLessonStore.getInitialState(), true);
  localStorage.clear();
});
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
    await screen.findAllByRole('button', { name: 'На доску' });
    const next = neighbours('how-to-use').next;
    if (!next) throw new Error('у how-to-use нет следующего урока');
    // Ссылка на урок есть и в левой колонке, поэтому ищем внутри навигации по соседним урокам
    const nav = screen.getByRole('navigation', { name: 'Соседние уроки' });
    expect(within(nav).getByRole('link')).toHaveAttribute('href', `/l/${next.id}`);
  });

  it('урок рендерит MDX-компоненты и документацию', async () => {
    renderAt('/l/how-to-use');
    expect((await screen.findAllByRole('button', { name: 'На доску' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Документация PostgreSQL' })).toBeInTheDocument();
  });

  it('открытый урок отмечается посещённым', async () => {
    renderAt('/l/select-basics');
    await screen.findAllByRole('button', { name: 'На доску' });
    expect(useLessonStore.getState().byId['select-basics']?.visited).toBe(true);
  });

  it('неизвестный урок: «Урок не найден», правая колонка жива', async () => {
    renderAt('/l/nope');
    expect(await screen.findByText('Урок не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /К первому уроку/ })).toHaveAttribute('href', '/l/how-to-use');
    expect(screen.getByRole('region', { name: 'Доска' })).toBeInTheDocument();
  });

  it('правая колонка из четырёх панелей, у ручек ресайза есть имена', async () => {
    renderAt('/l/how-to-use');
    for (const name of ['Доска', 'Таймлайн', 'Редактор', 'Результат']) {
      expect(await screen.findByRole('region', { name })).toBeInTheDocument();
    }
    const handles = screen.getAllByRole('separator').map((el) => el.getAttribute('aria-label'));
    expect(handles).toEqual([
      'Ширина списка уроков',
      'Граница теории и доски',
      'Высота доски',
      'Высота таймлайна',
      'Граница редактора и результата',
    ]);
  });

  it('⌘\\ прячет теорию и сайдбар, доска на всю ширину; повтор возвращает раскладку', async () => {
    renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    // userEvent.keyboard не проставляет code: 'Backslash', поэтому keyDown вручную
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(screen.queryAllByRole('button', { name: 'На доску' })).toHaveLength(0);
    expect(screen.queryByRole('navigation', { name: 'Уроки' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Ширина списка уроков' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect((await screen.findAllByRole('button', { name: 'На доску' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
  });

  it('ниже 80em панели сайдбара нет, уроки открываются в Sheet', async () => {
    mockMedia(['(max-width: 80em)']);
    const user = userEvent.setup();
    const { container } = render(
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/l/how-to-use'] })} />,
    );
    await screen.findAllByRole('button', { name: 'На доску' });
    expect(container.querySelector('[id="sidebar"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Уроки' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уроки' });
    expect(within(dialog).getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
  });

  it('переход по ссылке урока закрывает Sheet', async () => {
    mockMedia(['(max-width: 80em)']);
    const user = userEvent.setup();
    const router = renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уроки' });
    // глава с целевым уроком свёрнута: раскрываем
    await user.click(within(dialog).getByRole('button', { name: /^4\./ }));
    await user.click(within(dialog).getByRole('link', { name: /SELECT: колонки, выражения, алиасы/ }));
    expect(router.state.location.pathname).toBe('/l/select-basics');
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('закрытый Sheet возвращает фокус на кнопку «Уроки», выбор урока ставит фокус на его заголовок', async () => {
    mockMedia(['(max-width: 80em)']);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    await screen.findByRole('dialog', { name: 'Уроки' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Уроки' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const dialog = await screen.findByRole('dialog', { name: 'Уроки' });
    await user.click(within(dialog).getByRole('button', { name: /^4\./ }));
    await user.click(within(dialog).getByRole('link', { name: /SELECT: колонки, выражения, алиасы/ }));
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'SELECT: колонки, выражения, алиасы',
    });
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('Sheet не открывается сам после перехода узкий -> широкий -> узкий', async () => {
    const NARROW = '(max-width: 80em)';
    const resize = mockResizableMedia([NARROW]);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    await screen.findByRole('dialog', { name: 'Уроки' });
    resize([]);
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
    resize([NARROW]);
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('поиск из Sheet: Sheet закрывается, фокус в поле поиска', async () => {
    mockMedia(['(max-width: 80em)']);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    await user.click(screen.getByRole('button', { name: 'Уроки' }));
    const sheet = await screen.findByRole('dialog', { name: 'Уроки' });
    await user.click(within(sheet).getByRole('button', { name: /Поиск/ }));
    const input = await screen.findByPlaceholderText(/Урок, тема/);
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('на широком экране сайдбар на месте, кнопки «Уроки» нет', async () => {
    renderAt('/l/how-to-use');
    await screen.findAllByRole('button', { name: 'На доску' });
    expect(screen.getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Уроки' })).not.toBeInTheDocument();
  });

  it('узкий экран и режим фокуса: «Уроки» остаётся и открывает Sheet', async () => {
    mockMedia(['(max-width: 80em)']);
    useSettingsStore.setState({ focusMode: true });
    const user = userEvent.setup();
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/l/how-to-use'] })} />);
    expect(screen.queryAllByRole('button', { name: 'На доску' })).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'Уроки' }));
    expect(await screen.findByRole('dialog', { name: 'Уроки' })).toBeInTheDocument();
  });

  it('ниже 640px заглушка, «Всё равно открыть» её убирает', async () => {
    mockMedia(['(max-width: 80em)', '(max-width: 639px)']);
    const user = userEvent.setup();
    renderAt('/l/how-to-use');
    expect(await screen.findByText('see-the-query рассчитан на экран от 640 px')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Всё равно открыть' }));
    expect(screen.queryByText('see-the-query рассчитан на экран от 640 px')).not.toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: 'На доску' })).length).toBeGreaterThan(0);
  });
});
