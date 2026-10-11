import { byteToChar, charToByte } from './offsets';
import type { ClauseName, ClauseRange, ParsedStatement } from './types';

// Диапазоны клаузов: начало - location первого узла клауза, конец - начало следующего клауза
// по порядку записи или конец оператора (спека 5.5). Позиции - в полном тексте редактора.
// Допущение: курсор на ключевых словах (ORDER, GROUP), стоящих до первого узла клауза,
// относится к предыдущему клаузу - для связи курсор <-> стадия это достаточно.
export function clauseRanges(stmt: ParsedStatement): ClauseRange[] {
  const stmtBytes = charToByte(stmt.text, stmt.text.length);
  const starts: Array<{ clause: ClauseName; byte: number }> = [];
  const ast = stmt.ast as Record<string, unknown>;

  const byteFrom = stmt.byteFrom;
  if ('SelectStmt' in ast) {
    const sel = (ast.SelectStmt ?? {}) as Record<string, unknown>;
    pushIf(starts, 'with', loc(sel.withClause), byteFrom);
    pushIf(starts, 'select', loc(sel.targetList), byteFrom);
    pushIf(starts, 'from', loc(sel.fromClause), byteFrom);
    pushIf(starts, 'where', loc(sel.whereClause), byteFrom);
    pushIf(starts, 'group', loc(sel.groupClause), byteFrom);
    pushIf(starts, 'having', loc(sel.havingClause), byteFrom);
    pushIf(starts, 'window', loc(sel.windowClause), byteFrom);
    pushIf(starts, 'order', loc(sel.sortClause), byteFrom);
    pushIf(starts, 'limit', loc(sel.limitCount), byteFrom);
    pushIf(starts, 'offset', loc(sel.limitOffset), byteFrom);
    pushIf(starts, 'values', loc(sel.valuesLists), byteFrom);
  }
  if ('InsertStmt' in ast) {
    const ins = (ast.InsertStmt ?? {}) as Record<string, unknown>;
    pushIf(starts, 'with', loc(ins.withClause), byteFrom);
    pushIf(starts, 'into', loc(ins.relation), byteFrom);
    pushIf(starts, 'values', loc(ins.selectStmt), byteFrom);
    pushIf(starts, 'on_conflict', loc(ins.onConflictClause), byteFrom);
    pushIf(starts, 'returning', loc(ins.returningClause ?? ins.returningList), byteFrom);
  }
  if ('UpdateStmt' in ast) {
    const upd = (ast.UpdateStmt ?? {}) as Record<string, unknown>;
    pushIf(starts, 'with', loc(upd.withClause), byteFrom);
    pushIf(starts, 'set', loc(upd.targetList), byteFrom);
    pushIf(starts, 'from', loc(upd.fromClause), byteFrom);
    pushIf(starts, 'where', loc(upd.whereClause), byteFrom);
    pushIf(starts, 'returning', loc(upd.returningClause ?? upd.returningList), byteFrom);
  }
  if ('DeleteStmt' in ast) {
    const del = (ast.DeleteStmt ?? {}) as Record<string, unknown>;
    pushIf(starts, 'with', loc(del.withClause), byteFrom);
    pushIf(starts, 'from', loc(del.relation), byteFrom);
    pushIf(starts, 'using', loc(del.usingClause), byteFrom);
    pushIf(starts, 'where', loc(del.whereClause), byteFrom);
    pushIf(starts, 'returning', loc(del.returningClause ?? del.returningList), byteFrom);
  }

  const sorted = [...new Map(starts.map((s) => [s.clause, s.byte])).entries()].sort((a, b) => a[1] - b[1]);
  return sorted.map(([clause, byte], i) => {
    const fromChar = byteToChar(stmt.text, byte);
    const from = stmt.from + fromChar;
    const nextByte = i + 1 < sorted.length ? sorted[i + 1][1] : stmtBytes;
    const rawToChar = byteToChar(stmt.text, nextByte);
    const rawSlice = stmt.text.slice(fromChar, rawToChar);

    let trimmed = rawSlice;
    if (i + 1 < sorted.length) {
      const nextClause = sorted[i + 1][0];
      const pat = CLAUSE_KEYWORDS[nextClause];
      if (pat) {
        trimmed = trimmed.replace(pat, '');
      }
      trimmed = trimmed.trimEnd();
    } else {
      trimmed = trimmed.replace(/[\s;]+$/, '');
    }

    const to = from + trimmed.length;
    return { clause, from, to: Math.max(from, to) };
  });
}

const CLAUSE_KEYWORDS: Partial<Record<ClauseName, RegExp>> = {
  with: /\s*\bwith\s*$/i,
  select: /\s*\bselect\s*$/i,
  from: /\s*\bfrom\s*$/i,
  where: /\s*\bwhere\s*$/i,
  group: /\s*\bgroup\s+by\s*$/i,
  having: /\s*\bhaving\s*$/i,
  window: /\s*\bwindow\s*$/i,
  order: /\s*\border\s+by\s*$/i,
  limit: /\s*\blimit\s*$/i,
  offset: /\s*\boffset\s*$/i,
  values: /\s*\bvalues\s*$/i,
  into: /\s*\binto\s*$/i,
  set: /\s*\bset\s*$/i,
  returning: /\s*\breturning\s*$/i,
  on_conflict: /\s*\bon\s+conflict\s*$/i,
  using: /\s*\busing\s*$/i,
};

// Клауз под курсором
export function clauseAt(stmt: ParsedStatement, cursor: number): ClauseName | null {
  for (const r of clauseRanges(stmt)) {
    if (cursor >= r.from && cursor < r.to) return r.clause;
  }
  return null;
}

// Рекурсивный поиск минимальной неотрицательной позиции в поддереве узла
function loc(node: unknown): number | null {
  let min: number | null = null;
  function walk(n: unknown) {
    if (n == null) return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n !== 'object') return;
    const rec = n as Record<string, unknown>;
    if (typeof rec.location === 'number' && rec.location >= 0) {
      if (min === null || rec.location < min) {
        min = rec.location;
      }
    }
    for (const v of Object.values(rec)) {
      walk(v);
    }
  }
  walk(node);
  return min;
}

// loc() отдаёт абсолютные байты полного текста; внутри оператора работаем в относительных
function pushIf(
  starts: Array<{ clause: ClauseName; byte: number }>,
  clause: ClauseName,
  byte: number | null,
  byteFrom = 0,
): void {
  if (byte != null) starts.push({ clause, byte: byte - byteFrom });
}
