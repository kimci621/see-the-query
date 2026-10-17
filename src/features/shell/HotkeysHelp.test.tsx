import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HotkeysHelp } from './HotkeysHelp';

afterEach(() => vi.unstubAllGlobals());

describe('HotkeysHelp', () => {
  it('клавиши, которые ещё не работают, помечены «скоро»', () => {
    render(<HotkeysHelp open onOpenChange={() => undefined} />);
    for (const action of ['Пауза и продолжение сцены', 'Шаг сцены назад и вперёд', 'Закрыть сцену']) {
      expect(screen.getByText(action).parentElement).toHaveTextContent('скоро');
    }
    expect(screen.getByText('Применить запрос').parentElement).not.toHaveTextContent('скоро');
  });

  it('на Mac модификатор ⌘, на остальных Ctrl', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel' });
    const { unmount } = render(<HotkeysHelp open onOpenChange={() => undefined} />);
    expect(screen.getByText('Поиск по урокам').previousElementSibling).toHaveTextContent('⌘K');
    unmount();

    vi.stubGlobal('navigator', { ...navigator, platform: 'Win32' });
    render(<HotkeysHelp open onOpenChange={() => undefined} />);
    expect(screen.getByText('Поиск по урокам').previousElementSibling).toHaveTextContent('CtrlK');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('⌘');
  });

  it('Esc возвращает фокус туда, где он был до открытия', async () => {
    // Шпаргалку открывает клавиша ?, без DialogTrigger
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onKeyDown={(e) => e.key === '?' && setOpen(true)}>
            до шпаргалки
          </button>
          <HotkeysHelp open={open} onOpenChange={setOpen} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const before = screen.getByRole('button', { name: 'до шпаргалки' });
    before.focus();
    await user.keyboard('?');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(before).toHaveFocus();
  });
});
