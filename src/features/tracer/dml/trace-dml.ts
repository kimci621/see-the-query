import type { DbClient } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { type Prober, TraceFallback } from '../probe';
import type { Special, TraceFn } from '../route';
import type { Row, RowKey, Stage, TraceOptions } from '../types';
import { hasVolatile } from '../whitelist';
import { captureCascades, cascadeDiff } from './cascade';
import { sourceTrace } from './materialize';
import {
  type DmlNode,
  errorFocus,
  instrument,
  keyOf,
  resolveTarget,
  row,
  sameValue,
  snapshot,
  tryRun,
  userResult,
} from './shared';
import { collidingKeys, conflictColumnSets, insertColumns, insertErrorExtras } from './source';
import { whereStages } from './where';

type Op = 'insert' | 'update' | 'delete' | 'merge';
type DmlStage = Extract<Stage, { kind: 'dml' }>;

const OPS: Record<string, Op> = {
  InsertStmt: 'insert',
  UpdateStmt: 'update',
  DeleteStmt: 'delete',
  MergeStmt: 'merge',
};

// INSERT / UPDATE / DELETE / MERGE выполняются один раз с расширенным RETURNING.
export async function traceDml(
  stmt: ParsedStatement,
  db: DbClient,
  prober: Prober,
  opts: TraceOptions,
  traceSelect: TraceFn,
): Promise<Special | null> {
  const nodeName = Object.keys(stmt.ast)[0];
  const op = OPS[nodeName];
  const body = (stmt.ast as unknown as Record<string, DmlNode>)[nodeName];
  if (!op || body.withClause) return null;

  const target = resolveTarget(opts.schema, body.relation);
  if (!target) return null;
  if (
    op === 'merge' &&
    body.mergeWhenClauses?.some(
      (item) => item.MergeWhenClause.matchKind === 'MERGE_WHEN_NOT_MATCHED_BY_SOURCE',
    )
  )
    throw new TraceFallback('Пока не анимируется: WHEN NOT MATCHED BY SOURCE');
  if ((op === 'update' || op === 'delete') && hasVolatile(body.whereClause))
    throw new TraceFallback('Пока не анимируется: случайные значения в WHERE');

  const stages: Stage[] = [];
  const materialized = op === 'insert' ? await sourceTrace(body, target, db, opts, traceSelect) : null;
  if (materialized) stages.push({ ...materialized, id: `${stages.length}:materialize` });
  const where =
    op === 'update' || op === 'delete' ? await whereStages(stmt, body, target, prober, opts, op) : null;
  if (where)
    stages.push(
      ...where.stages.map((stage, index) => ({ ...stage, id: `${stages.length + index}:${stage.kind}` })),
    );
  const before = where ? where.stages[0].output : await snapshot(prober, target);
  const cascadeBefore =
    op === 'delete' || op === 'update' ? await captureCascades(target.table.id, opts.schema, prober, op) : [];
  const collisionKeys = body.onConflictClause
    ? [
        ...new Set(
          (
            await Promise.all(
              conflictColumnSets(body, target).map((columns) => collidingKeys(prober, body, target, columns)),
            )
          ).flat(),
        ),
      ]
    : [];
  const run = await tryRun(prober, instrument(stmt.ast, nodeName));
  if (!run.ok) {
    const extra = op === 'insert' ? await insertErrorExtras(prober, body, target, run.error) : {};
    stages.push({
      id: `${stages.length}:error`,
      kind: 'error',
      error: run.error,
      focus: errorFocus(run.error, target, opts.schema),
      caption: captions.error(run.error.code, run.error.message),
      output: { columns: [], rows: [] },
      ...extra,
    });
    return {
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages,
      result: null,
      error: run.error,
    };
  }

  const count = target.columns.length;
  const prefix = 2 + 2 * count;
  const byKey = new Map(before.rows.map((item) => [item.key, item]));
  const inserted: RowKey[] = [];
  const deleted: RowKey[] = [];
  const updated: DmlStage['updated'] = [];
  const added: Row[] = [];
  const mergeBranches: DmlStage['mergeBranches'] = {};

  for (const values of run.value.rows) {
    const oldCtid = values[0] as string | null;
    const newCtid = values[1] as string | null;
    const oldValues = values.slice(2, 2 + count);
    const newValues = values.slice(2 + count, 2 + 2 * count);
    if (oldCtid !== null && newCtid !== null) {
      const key = keyOf(target.alias, oldCtid);
      const changedColumns = target.columns
        .filter((_, index) => !sameValue(oldValues[index], newValues[index]))
        .map((column) => column.name);
      updated.push({ key, before: oldValues, after: newValues, changedColumns });
      byKey.set(key, row(target.alias, oldCtid, newValues));
      if (op === 'merge') mergeBranches[key] = 'matched_update';
    } else if (newCtid !== null) {
      const fresh = row(target.alias, newCtid, newValues);
      inserted.push(fresh.key);
      added.push(fresh);
      if (op === 'merge') mergeBranches[fresh.key] = 'not_matched_insert';
    } else {
      const key = keyOf(target.alias, oldCtid as string);
      deleted.push(key);
      if (op === 'merge') mergeBranches[key] = 'matched_delete';
    }
  }

  const given = insertColumns(body, target);
  const defaulted =
    op === 'insert'
      ? target.columns.map((column) => column.name).filter((column) => !given.includes(column))
      : [];
  const conflicts: DmlStage['conflicts'] = body.onConflictClause
    ? body.onConflictClause.action === 'ONCONFLICT_UPDATE'
      ? updated.map((item) => ({ key: item.key, action: 'update' }))
      : collisionKeys.map((key) => ({ key, action: 'nothing' }))
    : [];
  let cascades: DmlStage['cascades'];
  try {
    cascades = await cascadeDiff(prober, cascadeBefore);
  } catch {
    return {
      mode: 'final-only',
      fallbackReason: 'Проба каскада не удалась',
      stages: [],
      result: userResult(run.value, prefix),
      error: null,
    };
  }
  stages.push({
    id: `${stages.length}:dml`,
    kind: 'dml',
    op,
    tableId: target.table.id,
    inserted,
    deleted,
    updated,
    conflicts,
    mergeBranches,
    cascades,
    caption:
      op === 'update'
        ? captions.dmlUpdate(updated.length, before.rows.length)
        : op === 'delete'
          ? captions.dmlDelete(deleted.length, before.rows.length)
          : body.onConflictClause
            ? captions.dmlUpsert(inserted.length, conflicts.length)
            : op === 'merge'
              ? captions.dmlMerge(inserted.length, updated.length, deleted.length)
              : captions.dmlInsert(inserted.length, before.rows.length),
    output: { columns: target.columns, rows: [...byKey.values(), ...added] },
    sourceRange: { from: stmt.from, to: stmt.to },
    ...(defaulted.length ? { defaulted } : {}),
  });

  if (where) {
    const actual = new Set(op === 'delete' ? deleted : updated.map((item) => item.key));
    if (where.hit.length !== actual.size || where.hit.some((key) => !actual.has(key)))
      return {
        mode: 'final-only',
        fallbackReason: 'Сверка с прямым выполнением не сошлась',
        stages: [],
        result: userResult(run.value, prefix),
        error: null,
      };
  }

  return { mode: 'full', stages, result: userResult(run.value, prefix), error: null };
}
