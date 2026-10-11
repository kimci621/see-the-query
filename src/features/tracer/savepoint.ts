import type { DbClient } from '@/features/db/types';

// Выполняет fn под SAVEPOINT: ошибка внутри не ломает открытую транзакцию превью
export async function withSavepoint<T>(db: DbClient, fn: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT __vs_sp');
  try {
    const result = await fn();
    await db.query('RELEASE SAVEPOINT __vs_sp');
    return result;
  } catch (e) {
    // Откат может упасть сам (worker уже убит сторожем), наружу идёт исходная ошибка
    await db.query('ROLLBACK TO SAVEPOINT __vs_sp').catch(() => undefined);
    await db.query('RELEASE SAVEPOINT __vs_sp').catch(() => undefined);
    throw e;
  }
}
