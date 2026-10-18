import type { DbError } from '@/features/db/types';

export interface EditorDiagnostic {
  from: number;
  to: number;
  message: string;
}

// Слово под позицией: диагностика подчёркивает лексему, а не один символ.
// Имя в двойных кавычках целиком, буквы любого алфавита: \w знает только латиницу
function wordAt(text: string, at: number): { from: number; to: number } {
  const from = Math.max(0, Math.min(at, Math.max(0, text.length - 1)));
  const m = /"[^"]*"?|[\p{L}\p{N}_$]+/u.exec(text.slice(from));
  return m ? { from: from + m.index, to: from + m.index + m[0].length } : { from, to: from + 1 };
}

// Ошибка парсинга: position - символьная, 0-based, уже в координатах редактора
export function parseDiagnostic(text: string, err: { message: string; position: number }): EditorDiagnostic {
  return { ...wordAt(text, err.position), message: err.message };
}

// Абсолютная позиция ошибки Postgres в тексте редактора: position 1-based от начала оператора.
// Postgres считает в кодовых точках, JS в UTF-16: эмодзи перед ошибкой сдвинули бы позицию.
// ponytail: оператор ищется первым вхождением текста; дубликат оператора в редакторе
// подчеркнёт первый. Обновление - хранить from в трейсе, когда Ф5 строит трейс из ParsedStatement.
function pgOffset(text: string, stmtSql: string, err: DbError): number | null {
  if (err.position == null) return null;
  const stmtFrom = text.indexOf(stmtSql);
  if (stmtFrom < 0) return null;
  const before = Array.from(stmtSql)
    .slice(0, err.position - 1)
    .join('');
  return stmtFrom + before.length;
}

export function pgDiagnostic(text: string, stmtSql: string, err: DbError): EditorDiagnostic | null {
  const at = pgOffset(text, stmtSql, err);
  return at == null ? null : { ...wordAt(text, at), message: err.message };
}

// Правка-подсказка: заменяет слово под позицией ошибки на `fix.to`. null, если позиция не стоит
// на начале простого имени (ни пробел, ни `table.column`) или слово не равно `fix.from`.
export function applyFix(
  text: string,
  stmtSql: string,
  err: DbError,
  fix: { from: string; to: string },
): string | null {
  const at = pgOffset(text, stmtSql, err);
  if (at == null) return null;
  const word = /^[\w$]+/.exec(text.slice(at))?.[0];
  if (!word || /[\w$]/.test(text[at - 1] ?? '')) return null;
  if (text[at + word.length] === '.') return null;
  if (word.toLowerCase() !== fix.from.toLowerCase()) return null;
  return text.slice(0, at) + fix.to + text.slice(at + word.length);
}
