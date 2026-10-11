import { describe, expect, it } from 'vitest';
import { DbException } from '@/features/db/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { withSavepoint } from './savepoint';

describe('withSavepoint', () => {
  it('ошибка пробы не ломает транзакцию превью', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await expect(withSavepoint(db, () => db.query('select nme from book'))).rejects.toBeInstanceOf(
          DbException,
        );
        const r = await withSavepoint(db, () => db.query('select count(*)::int from book'));
        expect(r.rows).toEqual([[11]]);
      }),
    ));
});
