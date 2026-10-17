import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { DbException } from '@/features/db/types';
import { notifyDbError } from './notifyDbError';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('notifyDbError', () => {
  it('ошибка Postgres: заголовок и тело из словаря, оригинал в описании', () => {
    const e = new DbException({ code: '42P01', message: 'relation "books" does not exist' });
    notifyDbError(e, 'select * from books');
    expect(toast.error).toHaveBeenCalledWith(
      'Таблицы books нет',
      expect.objectContaining({ description: expect.stringContaining('relation "books" does not exist') }),
    );
  });

  it('не ошибка БД: «Не получилось» и текст', () => {
    notifyDbError(new Error('boom'), '');
    expect(toast.error).toHaveBeenLastCalledWith('Не получилось', { description: 'Error: boom' });
  });
});
