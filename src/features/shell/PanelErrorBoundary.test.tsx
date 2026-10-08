import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PanelErrorBoundary } from './PanelErrorBoundary';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('бум');
  return <p>живой</p>;
}

describe('PanelErrorBoundary', () => {
  it('ловит ошибку панели, показывает сообщение и перезапускает панель', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <PanelErrorBoundary name="Теория">
          <Bomb />
        </PanelErrorBoundary>
        <p>соседняя панель</p>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Панель «Теория» упала');
    expect(screen.getByText('бум')).toBeInTheDocument();
    expect(screen.getByText('соседняя панель')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Перезапустить панель' }));
    expect(screen.getByText('живой')).toBeInTheDocument();
    spy.mockRestore();
  });
});
