import type { Node, RawStmt } from '@pgsql/types';
import { loadModule, parseSync } from 'libpg-query';
import { byteToChar, charToByte } from './offsets';
import type { ParsedStatement, ParseOutcome, StatementKind } from './types';

let loadPromise: Promise<void> | null = null;
let parserLoaded = false;

export function isParserReady(): boolean {
  return parserLoaded;
}

// Идемпотентная загрузка WASM-парсера: вызывать можно много раз
export function initParser(): Promise<void> {
  loadPromise ??= loadModule().then(() => {
    parserLoaded = true;
  });
  return loadPromise;
}

// Разбор текста редактора на операторы. Позиции libpg-query в байтах UTF-8,
// переводим в символьные и обрезаем ';' и хвостовые пробелы из stmt_len.
export function parseSql(text: string): ParseOutcome {
  if (!text.trim()) {
    return { ok: true, statements: [] };
  }
  let raw: { stmts?: RawStmt[] };
  try {
    raw = parseSync(text);
  } catch (e) {
    const err = (e ?? {}) as SqlErrorLike;
    if (err.message === 'Query cannot be empty') {
      return { ok: true, statements: [] };
    }
    return { ok: false, error: toParseError(e) };
  }
  const textBytes = charToByte(text, text.length);
  const statements: ParsedStatement[] = [];
  let stmtIndex = 0;
  for (const item of raw.stmts ?? []) {
    if (!item.stmt) continue;
    const byteFrom = item.stmt_location ?? 0; // поле опускается, когда равно 0
    const byteTo = item.stmt_len != null ? byteFrom + item.stmt_len : textBytes;
    const from = byteToChar(text, byteFrom);
    const stmtText = text
      .slice(from, byteToChar(text, Math.min(byteTo, textBytes)))
      .replace(/;\s*$/, '')
      .trimEnd();
    statements.push({
      index: stmtIndex++,
      from,
      to: from + stmtText.length,
      byteFrom,
      text: stmtText,
      ast: item.stmt,
      kind: kindOf(item.stmt),
    });
  }
  return { ok: true, statements };
}

// Узел RawStmt.stmt - объект с единственным ключом-типом
function kindOf(node: Node): StatementKind {
  const key = Object.keys(node as Record<string, unknown>)[0] ?? '';
  if (key === 'SelectStmt') return 'select';
  if (key === 'InsertStmt') return 'insert';
  if (key === 'UpdateStmt') return 'update';
  if (key === 'DeleteStmt') return 'delete';
  if (key === 'MergeStmt') return 'merge';
  if (key === 'TransactionStmt') return 'tcl';
  if (/^(Create|Alter|Drop|Truncate|Rename|Comment|Refresh|Lock|Check|Cluster)/.test(key)) return 'ddl';
  return 'other';
}

interface SqlErrorLike {
  message?: string;
  sqlDetails?: { cursorPosition?: number };
}

// SqlError libpg-query: 0-based позиция курсора в кодовых точках (не UTF-16) в sqlDetails.cursorPosition
function toParseError(e: unknown): { message: string; position: number } {
  const err = (e ?? {}) as SqlErrorLike;
  const pos = typeof err.sqlDetails?.cursorPosition === 'number' ? err.sqlDetails.cursorPosition : 0;
  return { message: err.message ?? String(e), position: pos };
}
