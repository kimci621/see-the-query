import { describe, expect, it } from 'vitest';
import { withDataset } from '../../../tests/helpers/db';
import { toDbError } from './protocol';
import type { DbException } from './types';

describe('toDbError', () => {
  it('переводит position в число и сохраняет поля ограничения', async () => {
    await withDataset('bookstore', async (db) => {
      const parse = await db.query('select nme from book').catch((e: DbException) => e.db);
      expect(parse).toMatchObject({ code: '42703', message: 'column "nme" does not exist', position: 8 });

      const unique = await db
        .query(`insert into customer (name, email, created_at) values ('X', 'anna@example.com', now())`)
        .catch((e: DbException) => e.db);
      expect(unique).toMatchObject({
        code: '23505',
        constraint: 'customer_email_key',
        table: 'customer',
        detail: 'Key (email)=(anna@example.com) already exists.',
      });
      expect(unique).not.toHaveProperty('position');
    });
  }, 20000);

  it('не-Postgres ошибка становится XX000', () => {
    expect(toDbError(new Error('boom'))).toEqual({ code: 'XX000', message: 'boom' });
  });
});
