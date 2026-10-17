import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HotkeysHelp } from './HotkeysHelp';

describe('HotkeysHelp', () => {
  it('клавиши, которые ещё не работают, помечены «скоро»', () => {
    render(<HotkeysHelp open onOpenChange={() => undefined} />);
    for (const action of ['Пауза и продолжение сцены', 'Шаг сцены назад и вперёд', 'Закрыть сцену']) {
      expect(screen.getByText(action).parentElement).toHaveTextContent('скоро');
    }
    expect(screen.getByText('Применить запрос').parentElement).not.toHaveTextContent('скоро');
  });
});
