import { type DbError, DbException } from './types';

export type WorkerRequest =
  | { id: number; type: 'init'; dataDir?: Blob }
  | { id: number; type: 'query'; sql: string; params?: unknown[] }
  | { id: number; type: 'exec'; sql: string }
  | { id: number; type: 'dump' }
  | { id: number; type: 'version' };
export type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: DbError };

const TEXT_FIELDS = ['detail', 'hint', 'schema', 'table', 'column', 'constraint'] as const;

// DatabaseError из PGlite → DbError. Проверяем по форме, а не instanceof: ошибка может прийти из другого realm
export function toDbError(e: unknown): DbError {
  if (e instanceof DbException) return e.db;
  if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string') {
    const src = e as Record<string, unknown>;
    const err: DbError = { code: src.code as string, message: String(src.message ?? '') };
    for (const key of TEXT_FIELDS) if (typeof src[key] === 'string') err[key] = src[key];
    if (src.position !== undefined && src.position !== '') err.position = Number(src.position);
    return err;
  }
  // не ошибка Postgres (сбой wasm, баг в нашем коде): XX000 internal_error
  return { code: 'XX000', message: e instanceof Error ? e.message : String(e) };
}
