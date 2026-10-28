import type { DbClient } from '@/features/db/types';
import { parseSql } from '@/features/sql/parser';
import { captions } from '../captions';
import { sqlOf, TraceFallback } from '../probe';
import type { TraceFn } from '../route';
import type { Stage, TraceOptions } from '../types';
import { hasVolatile } from '../whitelist';
import type { DmlNode, Target } from './shared';
import { insertColumns } from './source';

// Вложенная трасса SELECT строится до INSERT, поэтому та же таблица-источник ещё не изменилась.
export async function sourceTrace(
  body: DmlNode,
  target: Target,
  db: DbClient,
  opts: TraceOptions,
  traceSelect: TraceFn,
): Promise<Extract<Stage, { kind: 'materialize' }> | null> {
  if (!body.selectStmt || !('SelectStmt' in body.selectStmt) || body.selectStmt.SelectStmt.valuesLists)
    return null;
  if (hasVolatile(body.selectStmt))
    throw new TraceFallback('Пока не анимируется: случайные значения в источнике INSERT');

  const parsed = parseSql(sqlOf(body.selectStmt));
  if (!parsed.ok) return null;
  const inner = await traceSelect(parsed.statements[0], db, opts);
  if (inner.mode !== 'full' || !inner.result) return null;

  const columns = insertColumns(body, target)
    .slice(0, inner.result.fields.length)
    .map((name) => ({
      name,
      type: target.columns.find((column) => column.name === name)?.type ?? 'unknown',
    }));
  return {
    id: '0:materialize',
    kind: 'materialize',
    name: 'SELECT',
    inner,
    caption: captions.materialize('SELECT', inner.result.rows.length),
    output: {
      columns,
      rows: inner.result.rows.map((values, index) => ({ key: `src:${index}`, lineage: {}, values })),
    },
  };
}
