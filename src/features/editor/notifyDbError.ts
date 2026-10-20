import { toast } from 'sonner';
import type { Sandbox } from '@/features/db/sandbox';
import { DbException, hasRowCount, type QueryResult } from '@/features/db/types';
import { DICTIONARY } from '@/features/errors/dictionary';
import { explainError } from '@/features/errors/explain';
import { parseSql } from '@/features/sql/parser';
import { rowsWord } from '@/lib/plural';
import { useBoardStore } from '@/stores/board';

// Тост ошибки применения: объяснение словаря по-русски и оригинал Postgres (спека 5.14).
// sql - оператор или текст, из которого пришла ошибка: словарь по нему ищет таблицы.
export function notifyDbError(e: unknown, sql: string): void {
  if (!(e instanceof DbException)) {
    toast.error('Не получилось', { description: String(e) });
    return;
  }
  const { title, body } = explainError(e.db, { sql, schema: useBoardStore.getState().schema });
  // кода нет в словаре: заголовок общий, поэтому код пишем в него; тело там и есть оригинал, второй раз не печатаем
  toast.error(e.db.code in DICTIONARY ? title : `${title} (${e.db.code})`, {
    description: body === e.db.message ? body : `${body}\n${e.db.message}`,
    style: { whiteSpace: 'pre-line' },
  });
}

// Тосты «Применить» и «Отменить» делят id: новый заменяет прежний, а не встаёт стопкой
const APPLY_TOAST = 'apply';

// Тост итога применения. Только SELECT (или пусто): «Выполнено», база не менялась.
// Иначе «Записано в базу», описание по последнему не-SELECT результату.
export function notifyApplied(results: QueryResult[]): void {
  const isSelect = (r: QueryResult) => r.command === 'SELECT';
  const wrote = results.findLast((r) => !isSelect(r));
  const last = wrote ?? results.at(-1);
  const description = last?.command
    ? hasRowCount(last.command)
      ? `${last.command}: ${rowsWord(last.rowCount ?? 0)}`
      : last.command
    : undefined;
  toast.success(wrote ? 'Записано в базу' : 'Выполнено', {
    id: APPLY_TOAST,
    ...(description && { description }),
  });
}

// Тип оператора для тоста: INSERT, UPDATE, DELETE, MERGE, иначе первое слово (CREATE, DROP)
function commandOf(sql: string): string {
  const parsed = parseSql(sql);
  const kind = parsed.ok ? parsed.statements[0]?.kind : undefined;
  if (kind === 'insert' || kind === 'update' || kind === 'delete' || kind === 'merge')
    return kind.toUpperCase();
  return sql.trim().split(/\s+/)[0].toUpperCase();
}

// Отмена последнего применённого (кнопка и ⌘Z): тост «Отменено: INSERT» на месте тоста записи
export async function undoLast(sandbox: Sandbox): Promise<void> {
  const last = sandbox.journal().at(-1);
  await sandbox.undo();
  if (last !== undefined) toast.success(`Отменено: ${commandOf(last)}`, { id: APPLY_TOAST });
}
