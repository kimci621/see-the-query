import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocaleBoundary } from '@/app/LocaleBoundary';
import { useSettingsStore } from '@/stores/settings';
import { LanguageToggle } from './LanguageToggle';

beforeEach(() => useSettingsStore.setState({ locale: 'ru' }));

function renderAt(url: string) {
  const router = createMemoryRouter(
    [{ element: <LocaleBoundary />, children: [{ path: '/l/:lessonId', element: <LanguageToggle /> }] }],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('переключение языка', () => {
  it('язык ссылки имеет приоритет над сохранённым и задаёт язык страницы', async () => {
    renderAt('/l/inner-join?lang=en');
    await waitFor(() => expect(useSettingsStore.getState().locale).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('button', { name: /switch.*russian/i })).toBeInTheDocument();
  });

  it('сохраняет адрес и возвращает язык при переходе назад', async () => {
    const router = renderAt('/l/inner-join?lang=ru&example=1#part');
    fireEvent.click(screen.getByRole('button', { name: /английск/i }));
    await waitFor(() => expect(router.state.location.search).toBe('?lang=en&example=1'));
    expect(router.state.location.pathname).toBe('/l/inner-join');
    expect(router.state.location.hash).toBe('#part');
    expect(useSettingsStore.getState().locale).toBe('en');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(useSettingsStore.getState().locale).toBe('ru'));
    expect(document.documentElement.lang).toBe('ru');
  });

  it('добавляет язык к старой ссылке и сохраняет прочие параметры', async () => {
    const router = renderAt('/l/inner-join?example=1');
    await waitFor(() => expect(router.state.location.search).toBe('?example=1&lang=ru'));
  });
});
