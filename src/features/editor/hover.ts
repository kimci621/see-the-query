import { parseSql } from '@/features/sql/parser';
import { relationsOf } from '@/features/sql/relations';
import { statementAt } from '@/features/sql/statements';
import type { ColumnRef, RangeRef } from '@/features/sql/types';

// Колонка под позицией курсора и таблицы её оператора (для hover-тултипа и подсветки на доске)
export function columnContextAt(text: string, pos: number): { column: ColumnRef; tables: RangeRef[] } | null {
  const parsed = parseSql(text);
  if (!parsed.ok) return null;
  const stmt = statementAt(parsed.statements, pos);
  if (!stmt) return null;
  const rel = relationsOf(stmt);
  const column = rel.columns.find((c) => pos >= c.from && pos <= c.to);
  return column ? { column, tables: rel.tables } : null;
}
