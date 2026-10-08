import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CommandMenu } from './CommandMenu';

function renderMenu(onOpenChange = vi.fn()) {
  const router = createMemoryRouter(
    [{ path: '*', element: <CommandMenu open onOpenChange={onOpenChange} /> }],
    { initialEntries: ['/l/how-to-use'] },
  );
  render(<RouterProvider router={router} />);
  return { router, onOpenChange };
}

describe('CommandMenu', () => {
  it('ищет по тегам', async () => {
    renderMenu();
    await userEvent.type(screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'), 'алиас');
    expect(screen.getByRole('option', { name: /SELECT: колонки, выражения, алиасы/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Как пользоваться доской/ })).not.toBeInTheDocument();
  });

  it('ищет по номеру урока', async () => {
    renderMenu();
    await userEvent.type(screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'), '4.1');
    expect(screen.getByRole('option', { name: /SELECT: колонки/ })).toBeInTheDocument();
  });

  it('Enter открывает урок и закрывает меню', async () => {
    const { router, onOpenChange } = renderMenu();
    await userEvent.type(screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'), 'алиас{Enter}');
    expect(router.state.location.pathname).toBe('/l/select-basics');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('пустой результат', async () => {
    renderMenu();
    await userEvent.type(screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'), 'zzzz');
    expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
  });
});
