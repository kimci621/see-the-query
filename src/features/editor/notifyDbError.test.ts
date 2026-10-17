import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { DbException, type QueryResult } from '@/features/db/types';
import { notifyApplied, notifyDbError } from './notifyDbError';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('notifyDbError', () => {
  it('ошибка Postgres: заголовок и тело из словаря, оригинал в описании', () => {
    const e = new DbException({ code: '42P01', message: 'relation "books" does not exist' });
    notifyDbError(e, 'select * from books');
    expect(toast.error).toHaveBeenCalledWith(
      'Таблицы books нет',
      expect.objectContaining({ description: expect.stringContaining('relation "books" does not exist') }),
    );
  });

  it('код вне словаря: SQLSTATE в заголовке, текст один раз', () => {
    notifyDbError(
      new DbException({ code: '2BP01', message: 'cannot drop table author' }),
      'drop table author',
    );
    expect(toast.error).toHaveBeenLastCalledWith('Postgres отклонил запрос (2BP01)', {
      description: 'cannot drop table author',
      style: { whiteSpace: 'pre-line' },
    });
  });

  it('не ошибка БД: «Не получилось» и текст', () => {
    notifyDbError(new Error('boom'), '');
    expect(toast.error).toHaveBeenLastCalledWith('Не получилось', { description: 'Error: boom' });
  });
});

const res = (command: string | undefined, rowCount?: number): QueryResult => ({
  command,
  rowCount,
  rows: [],
  fields: [],
});

describe('notifyApplied', () => {
  it('INSERT: «Записано в базу» и число строк', () => {
    notifyApplied([res('INSERT', 1)]);
    expect(toast.success).toHaveBeenLastCalledWith('Записано в базу', { description: 'INSERT: 1 строка' });
  });

  it('только SELECT: «Выполнено»', () => {
    notifyApplied([res('SELECT', 3)]);
    expect(toast.success).toHaveBeenLastCalledWith('Выполнено', { description: 'SELECT: 3 строки' });
  });

  it('insert и select: описание по последнему не-SELECT', () => {
    notifyApplied([res('INSERT', 1), res('SELECT', 7)]);
    expect(toast.success).toHaveBeenLastCalledWith('Записано в базу', { description: 'INSERT: 1 строка' });
  });

  it('DDL: только команда, без «0 строк» (так PGlite отдаёт CREATE)', () => {
    notifyApplied([res('CREATE', 0)]);
    expect(toast.success).toHaveBeenLastCalledWith('Записано в базу', { description: 'CREATE' });
  });

  it('пустой результат: «Выполнено» без описания', () => {
    notifyApplied([]);
    expect(toast.success).toHaveBeenLastCalledWith('Выполнено', undefined);
  });
});
