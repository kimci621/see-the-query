import type { DbError } from '@/features/db/types';
import { DICTIONARY, type ErrorContext, type ErrorExplanation } from './dictionary';

export type { ErrorExplanation } from './dictionary';

export function explainError(err: DbError, ctx: ErrorContext): ErrorExplanation {
  const entry = DICTIONARY[err.code];
  if (entry) return entry(err, ctx);
  // кода нет в словаре: показываем оригинал. Код карточка печатает рядом с заголовком сама
  return {
    title: 'Postgres отклонил запрос',
    body: err.message,
    suggestion: err.hint,
    highlight: { tableIds: [], columns: [] },
  };
}
