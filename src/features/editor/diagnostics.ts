import type { DbError } from '@/features/db/types';

export interface EditorDiagnostic {
  from: number;
  to: number;
  message: string;
}

// Слово под позицией: диагностика подчёркивает лексему, а не один символ
function wordAt(text: string, at: number): { from: number; to: number } {
  const from = Math.max(0, Math.min(at, Math.max(0, text.length - 1)));
  const m = /[\w$]+/.exec(text.slice(from));
  return m ? { from: from + m.index, to: from + m.index + m[0].length } : { from, to: from + 1 };
}

// Ошибка парсинга: position - символьная, 0-based, уже в координатах редактора
export function parseDiagnostic(text: string, err: { message: string; position: number }): EditorDiagnostic {
  return { ...wordAt(text, err.position), message: err.message };
}

// Ошибка Postgres: position 1-based от начала оператора, переводим в абсолютную позицию редактора.
// ponytail: оператор ищется первым вхождением текста; дубликат оператора в редакторе
// подчеркнёт первый. Обновление - хранить from в трейсе, когда Ф5 строит трейс из ParsedStatement.
export function pgDiagnostic(text: string, stmtSql: string, err: DbError): EditorDiagnostic | null {
  if (err.position == null) return null;
  const stmtFrom = text.indexOf(stmtSql);
  if (stmtFrom < 0) return null;
  return { ...wordAt(text, stmtFrom + err.position - 1), message: err.message };
}
