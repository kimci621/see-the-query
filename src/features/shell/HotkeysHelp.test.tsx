import { render, screen } from '@testing-library/react';
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
});
