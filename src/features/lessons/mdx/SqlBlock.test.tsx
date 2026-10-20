import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initParser } from '@/features/sql/parser';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { SqlBlock } from './SqlBlock';

const { apply, notifyApplied, notifyDbError, sandboxState } = vi.hoisted(() => ({
  apply: vi.fn(),
  notifyApplied: vi.fn(),
  notifyDbError: vi.fn(),
  sandboxState: { ready: true },
}));
vi.mock('@/features/db/SandboxProvider', () => ({
  useSandbox: () => ({ sandbox: sandboxState.ready ? { apply } : null, status: 'ready', version: null }),
}));
vi.mock('@/features/editor/notifyDbError', () => ({ notifyApplied, notifyDbError }));

type BlockProps = { 'data-lang': string; 'data-meta': string; 'data-code': string };
const SQL = 'select b.title, a.name from book b join author a using (author_id);';
const writeText = vi.fn();

function renderBlock(props: BlockProps) {
  const element = (
    <SqlBlock {...props}>
      <code>{props['data-code']}</code>
    </SqlBlock>
  );
  const router = createMemoryRouter([{ path: '/l/:lessonId', element }], {
    initialEntries: ['/l/inner-join'],
  });
  render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  sandboxState.ready = true;
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useLessonStore.setState({ byId: {} });
  apply.mockReset().mockResolvedValue([]);
  notifyApplied.mockReset();
  notifyDbError.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await initParser();
});

describe('SqlBlock', () => {
  it('«На доску» кладёт запрос в редактор и отмечает запуск примера', () => {
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'run expect=rows:9', 'data-code': SQL });
    fireEvent.click(screen.getByRole('button', { name: 'На доску' }));
    expect(useEditorStore.getState().text).toBe(SQL);
    expect(useLessonStore.getState().byId['inner-join']?.ranExample).toBe(true);
  });

  it('без run кнопки «На доску» нет, «Копировать» копирует исходник', async () => {
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'noexec', 'data-code': SQL });
    expect(screen.queryByRole('button', { name: 'На доску' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    expect(writeText).toHaveBeenCalledWith(SQL);
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument();
  });

  it('apply: «Применить» кладёт запрос в редактор, применяет его и показывает тост итога', async () => {
    const insert = "insert into author (name) values ('Лев Толстой') returning author_id;";
    const results = [{ command: 'INSERT', rowCount: 1 }];
    apply.mockResolvedValue(results);
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'apply expect=rows:1', 'data-code': insert });
    expect(screen.queryByRole('button', { name: 'На доску' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    // оператор из разбора, как у кнопки редактора: без завершающей точки с запятой
    await waitFor(() => expect(apply).toHaveBeenCalledWith(insert.slice(0, -1)));
    await waitFor(() => expect(notifyApplied).toHaveBeenCalledWith(results));
    expect(useEditorStore.getState().text).toBe(insert);
    // тот же путь, что у кнопки редактора: оператор применён, тулбар пишет «Применено», превью его не повторяет
    expect(useEditorStore.getState().applied[0]?.result).toEqual(results[0]);
  });

  it('apply: двойной клик применяет один раз, пока база отвечает кнопка занята', async () => {
    let resolve: (r: unknown[]) => void = () => undefined;
    apply.mockReturnValue(new Promise((r) => (resolve = r)));
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'apply', 'data-code': 'delete from book;' });
    const button = screen.getByRole('button', { name: 'Применить' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    resolve([{ command: 'DELETE', rowCount: 11 }]);
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('apply: пока песочница не готова, «Применить» выключена и запрос в редактор не кладёт', () => {
    sandboxState.ready = false;
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'apply', 'data-code': 'delete from book;' });
    const button = screen.getByRole('button', { name: 'Применить' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(useEditorStore.getState().text).toBe('');
  });

  it('apply: ошибка идёт в notifyDbError вместе с запросом', async () => {
    const err = new Error('boom');
    apply.mockRejectedValue(err);
    renderBlock({ 'data-lang': 'sql', 'data-meta': 'apply', 'data-code': 'delete from book;' });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(notifyDbError).toHaveBeenCalledWith(err, 'delete from book'));
    expect(notifyApplied).not.toHaveBeenCalled();
  });

  it('не-SQL блок без кнопок, атрибуты pre на месте', () => {
    renderBlock({ 'data-lang': 'bash', 'data-meta': '', 'data-code': 'pnpm dev' });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('pnpm dev').closest('pre')).toHaveAttribute('data-lang', 'bash');
  });

  it('у SQL-блока pre сохраняет мету для e2e', () => {
    renderBlock({
      'data-lang': 'sql',
      'data-meta': 'run expect=rows:11',
      'data-code': 'select * from book;',
    });
    expect(screen.getByText('select * from book;').closest('pre')).toHaveAttribute(
      'data-meta',
      'run expect=rows:11',
    );
  });
});
