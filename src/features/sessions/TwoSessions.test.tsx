import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TwoSessionsBlock } from '@/features/lessons/mdx/TwoSessionsBlock';

describe('две сессии', () => {
  it('показывает шаги отдельно и не раскрывает будущие результаты как выполненные', () => {
    render(<TwoSessionsBlock id="tx-basic" />);
    const scene = screen.getByRole('region', { name: 'Фиксация транзакции' });
    expect(within(scene).getByRole('region', { name: 'Сессия A' })).toBeVisible();
    expect(within(scene).getByRole('region', { name: 'Сессия B' })).toBeVisible();
    expect(within(scene).getByText('Шаг 1 из 5')).toBeVisible();
    expect(within(scene).queryByText('890.00')).toBeNull();
    fireEvent.click(within(scene).getByRole('button', { name: 'Дальше' }));
    expect(within(scene).getByText('A видит новую цену 1,00.')).toBeVisible();
    fireEvent.click(within(scene).getByRole('button', { name: 'Дальше' }));
    expect(within(scene).getByText('B видит прежнюю цену 890,00.')).toBeVisible();
  });

  it('показывает ожидание до освобождения и заменяет устаревшую подпись', () => {
    render(<TwoSessionsBlock id="lock-for-update" />);
    const scene = screen.getByRole('region', { name: 'Ожидание блокировки строки' });
    const next = within(scene).getByRole('button', { name: 'Дальше' });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(scene.querySelector('[data-step="3"]')).toHaveAttribute('data-state', 'running');
    expect(within(scene).getByText('B ждёт завершения транзакции A.')).toBeVisible();
    fireEvent.click(next);
    expect(scene.querySelector('[data-step="3"]')).toHaveAttribute('data-state', 'done');
    expect(within(scene).getByText('B получила блокировку после COMMIT A.')).toBeVisible();
    expect(within(scene).queryByText('B ждёт завершения транзакции A.')).toBeNull();
    fireEvent.keyDown(scene, { key: 'ArrowLeft' });
    expect(scene.querySelector('[data-step="3"]')).toHaveAttribute('data-state', 'running');
  });

  it('неизвестный сценарий показывает ошибку', () => {
    render(<TwoSessionsBlock id="нет-сценария" />);
    expect(screen.getByRole('alert')).toHaveTextContent('нет-сценария');
  });
});
