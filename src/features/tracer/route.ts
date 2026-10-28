import { type DbClient, DbException } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { traceDdl } from './ddl/trace-ddl';
import { traceDml } from './dml/trace-dml';
import { traceTruncate } from './dml/truncate';
import { ProbeOverflow, type Prober, TraceFallback } from './probe';
import type { Trace, TraceOptions } from './types';

export type Special = Pick<Trace, 'mode' | 'stages' | 'result' | 'error' | 'fallbackReason'>;
export type TraceFn = (stmt: ParsedStatement, db: DbClient, opts: TraceOptions) => Promise<Trace>;

const DML = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt']);
const DDL = new Set([
  'CreateStmt',
  'AlterTableStmt',
  'DropStmt',
  'CreateSchemaStmt',
  'IndexStmt',
  'ViewStmt',
  'CommentStmt',
  'RenameStmt',
  'CreateSeqStmt',
  'AlterSeqStmt',
  'CreateTableAsStmt',
  'AlterObjectSchemaStmt',
]);

// Операторы Ф9 маршрутизируются по имени AST-узла, а не по stmt.kind.
export async function traceSpecial(
  stmt: ParsedStatement,
  db: DbClient,
  prober: Prober,
  opts: TraceOptions,
  traceSelect: TraceFn,
): Promise<Special | string | null> {
  const node = Object.keys(stmt.ast)[0];
  try {
    if (DML.has(node)) return await traceDml(stmt, db, prober, opts, traceSelect);
    if (node === 'TruncateStmt') return await traceTruncate(stmt, prober, opts);
    if (DDL.has(node)) return await traceDdl(stmt, db, prober, opts);
  } catch (error) {
    if (error instanceof ProbeOverflow) return 'Пока не анимируется: таблица больше лимита строк';
    if (error instanceof TraceFallback) return error.message;
    if (error instanceof DbException && !error.db.code.startsWith('VS'))
      return `Проба не удалась: ${error.db.message}`;
    throw error;
  }
  return null;
}
