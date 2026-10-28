import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import type { Prober } from '../probe';
import type { Special } from '../route';
import type { Relation, Stage, TraceOptions } from '../types';
import { errorFocus, resolveTarget, snapshot, targetOf, tryRun } from './shared';

interface TruncateNode {
  relations?: Array<{ RangeVar: { relname: string; schemaname?: string } }>;
  behavior?: string;
}

// Потомки TRUNCATE ... CASCADE: ограничение FK неважно, Postgres очищает все связанные таблицы.
function cascadeTables(tableId: string, schema: TraceOptions['schema']): string[] {
  const ids: string[] = [];
  const seen = new Set([tableId]);
  const visit = (parentId: string) => {
    for (const fk of schema.fks.filter((item) => item.to.tableId === parentId)) {
      if (seen.has(fk.from.tableId)) continue;
      seen.add(fk.from.tableId);
      ids.push(fk.from.tableId);
      visit(fk.from.tableId);
    }
  };
  visit(tableId);
  return ids;
}

export async function traceTruncate(
  stmt: ParsedStatement,
  prober: Prober,
  opts: TraceOptions,
): Promise<Special | string | null> {
  const body = (stmt.ast as unknown as { TruncateStmt?: TruncateNode }).TruncateStmt;
  const relations = body?.relations ?? [];
  if (relations.length !== 1) return 'Пока не анимируется: TRUNCATE нескольких таблиц';
  const target = resolveTarget(opts.schema, relations[0].RangeVar);
  if (!target) return null;
  const before = await snapshot(prober, target);
  const cascades: Array<{ tableId: string; before: Relation }> = [];
  if (body?.behavior === 'DROP_CASCADE') {
    for (const tableId of cascadeTables(target.table.id, opts.schema)) {
      const table = opts.schema.tables.find((item) => item.id === tableId);
      if (table) cascades.push({ tableId, before: await snapshot(prober, targetOf(table)) });
    }
  }
  const run = await tryRun(prober, stmt.text);
  if (!run.ok) {
    const stage: Stage = {
      id: '0:error',
      kind: 'error',
      error: run.error,
      focus: errorFocus(run.error, target, opts.schema),
      caption: captions.error(run.error.code, run.error.message),
      output: { columns: [], rows: [] },
    };
    return {
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [stage],
      result: null,
      error: run.error,
    };
  }
  return {
    mode: 'full',
    stages: [
      {
        id: '0:dml',
        kind: 'dml',
        op: 'truncate',
        tableId: target.table.id,
        inserted: [],
        deleted: before.rows.map((item) => item.key),
        updated: [],
        conflicts: [],
        mergeBranches: {},
        cascades: cascades
          .map(({ tableId, before }) => ({
            tableId,
            deleted: before.rows.map((item) => item.key),
            updated: [],
          }))
          .filter((item) => item.deleted.length),
        caption: captions.dmlTruncate(target.table.name, before.rows.length),
        output: before,
        sourceRange: { from: stmt.from, to: stmt.to },
      },
    ],
    result: run.value,
    error: null,
  };
}
