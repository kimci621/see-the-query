import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MvccPage } from './MvccPage';

const mocks = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), close: vi.fn() }));
vi.mock('@/features/db/client', () => ({ createWorkerClient: mocks.create }));
vi.mock('@/features/scenes/mvcc-scene', () => ({ runMvccScene: mocks.run }));

const facts = { committed: [1], aborted: [], lockers: [] };
const steps = [
  {
    caption: 'Три строки',
    versions: [{ lp: 1, lpFlags: 1, xmin: 1, xmax: 0, ctid: '(0,1)' }],
    facts,
    visible: [{ id: '1', val: 'a' }],
  },
  {
    caption: 'Строка обновлена',
    versions: [{ lp: 1, lpFlags: 1, xmin: 1, xmax: 2, ctid: '(0,2)' }],
    facts: { ...facts, committed: [1, 2] },
    visible: [{ id: '1', val: 'a2' }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ close: mocks.close });
  mocks.run.mockResolvedValue(steps);
});

describe('сцена MVCC', () => {
  it('показывает настоящие версии, переключает шаги и сохраняет фокус', async () => {
    render(<MvccPage />);
    expect(await screen.findByText('Три строки')).toBeVisible();
    const scene = screen.getByRole('region', { name: 'Версии строк PostgreSQL' });
    expect(within(scene).getByText('Шаг 1 из 2')).toBeVisible();
    expect(within(scene).getByText('(0,1)')).toBeVisible();
    expect(within(scene).getByText('видна')).toBeVisible();
    const next = within(scene).getByRole('button', { name: 'Дальше' });
    next.focus();
    fireEvent.click(next);
    expect(within(scene).getByText('Строка обновлена')).toBeVisible();
    expect(within(scene).getByText('устарела')).toBeVisible();
    expect(within(scene).getByText('a2')).toBeVisible();
    expect(within(scene).getByRole('button', { name: 'Назад' })).toHaveFocus();
    fireEvent.keyDown(scene, { key: 'ArrowLeft' });
    expect(within(scene).getByText('Три строки')).toBeVisible();
    await waitFor(() => expect(mocks.close).toHaveBeenCalled());
  });

  it('сообщает об ошибке и даёт повторить загрузку', async () => {
    mocks.run.mockRejectedValueOnce(new Error('pageinspect недоступен'));
    render(<MvccPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('pageinspect недоступен');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Три строки')).toBeVisible();
  });

  it('останавливает worker, если пользователь ушёл во время расчёта', async () => {
    let finish: (value: typeof steps) => void = () => undefined;
    mocks.run.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<MvccPage />);
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(mocks.close).toHaveBeenCalled();
    finish(steps);
  });

  it('закрывает базу, даже если компонент снят до завершения запуска', async () => {
    let finish: (client: { close: typeof mocks.close }) => void = () => undefined;
    mocks.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<MvccPage />);
    view.unmount();
    finish({ close: mocks.close });
    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
