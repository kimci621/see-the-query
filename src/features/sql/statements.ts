import type { ParsedStatement } from './types';

// Оператор под курсором: последний, начавшийся не позже курсора.
// Курсор в ';' или комментарии между операторами относится к ближайшему слева (как в DataGrip).
export function statementAt(stmts: ParsedStatement[], cursor: number): ParsedStatement | null {
  if (stmts.length === 0) return null;
  if (cursor <= stmts[0].from) return stmts[0];
  let best: ParsedStatement | null = null;
  for (const s of stmts) {
    if (s.from > cursor) break;
    best = s;
    if (cursor <= s.to) return s;
  }
  return best;
}
