import { render, screen, waitFor } from '@testing-library/react';
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
    await userEvent.type(
      screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'),
      'выражения{Enter}',
    );
    expect(router.state.location.pathname).toBe('/l/select-basics');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('пустой результат', async () => {
    renderMenu();
    await userEvent.type(screen.getByPlaceholderText('Урок, тема, ключевое слово SQL...'), 'zzzz');
    expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
  });
});

describe('CommandMenu: фокус', () => {
  it('после закрытия фокус возвращается на элемент, бывший в фокусе до открытия', async () => {
    const Host = ({ open }: { open: boolean }) => (
      <>
        <button type="button">до палитры</button>
        <CommandMenu open={open} onOpenChange={() => undefined} />
      </>
    );
    const router = (open: boolean) =>
      createMemoryRouter([{ path: '*', element: <Host open={open} /> }], { initialEntries: ['/'] });
    const { rerender } = render(<RouterProvider router={router(false)} />);
    const button = screen.getByRole('button', { name: 'до палитры' });
    button.focus();
    rerender(<RouterProvider router={router(true)} />);
    await screen.findByPlaceholderText('Урок, тема, ключевое слово SQL...');
    expect(button).not.toHaveFocus();
    rerender(<RouterProvider router={router(false)} />);
    await waitFor(() => expect(button).toHaveFocus());
  });
});
