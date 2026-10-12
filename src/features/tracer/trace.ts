import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from './captions';
import { createProber, ProbeOverflow, TraceFallback, typeNames } from './probe';
import { resultKey } from './rowkey';
import { runCompressed } from './select/compressed';
import { createSelectCtx, rangeOf, stableCanon } from './select/context';
import { flattenFrom } from './select/join';
import { runSelect } from './select/pipeline';
import type { Stage, Trace, TraceOptions } from './types';
import { sameResult } from './verify';
import { selectFeatures, touchedOf, unsupportedReason } from './whitelist';

// Вызывающий обязан обернуть вызов в sandbox.preview: транзакция уже открыта
export async function traceStatement(
  stmt: ParsedStatement,
  db: DbClient,
  opts: TraceOptions,
): Promise<Trace> {
  const started = performance.now();
  const prober = createProber(db, { signal: opts.signal, maxRows: opts.maxRows ?? 2000 });
  const touched = touchedOf(stmt.ast, opts.schema);
  const finish = (t: Pick<Trace, 'mode' | 'stages' | 'result' | 'error' | 'fallbackReason'>): Trace => ({
    sql: stmt.text,
    statementType: stmt.kind,
    touched,
    notices: [],
    ...t,
    timingMs: Math.round(performance.now() - started),
  });

  // COMMIT или ROLLBACK внутри превью сломал бы его транзакцию
  if (stmt.kind === 'tcl') {
    return finish({
      mode: 'final-only',
      fallbackReason: 'Команды транзакций в превью не выполняются',
      stages: [],
      result: null,
      error: null,
    });
  }

  // Эталон: оператор как есть. Ошибка Postgres → стадия error
  let reference: QueryResult;
  try {
    reference = await prober.run(stmt.text);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    const error = e.db;
    const stage: Stage = {
      id: '0:error',
      kind: 'error',
      error,
      focus: touched,
      caption: captions.error(error.code, error.message),
      output: { columns: [], rows: [] },
    };
    return finish({
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [stage],
      result: null,
      error,
    });
  }
  const finalOnly = (fallbackReason: string) =>
    finish({ mode: 'final-only', fallbackReason, stages: [], result: reference, error: null });

  const reason = unsupportedReason(stmt);
  if (reason !== null) return finalOnly(reason);
  if (!('SelectStmt' in stmt.ast)) return finalOnly('Пока не анимируется');
  const sel = stmt.ast.SelectStmt;
  const volatile = selectFeatures(sel).has('volatile');

  // SELECT без FROM: одна стадия, значения прямо из эталона
  if (!sel.fromClause) {
    const types = await typeNames(
      prober,
      reference.fields.map((f) => f.dataTypeID),
      new Map(),
    );
    const columns = reference.fields.map((f) => ({
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
    }));
    const stage: Stage = {
      id: '0:project',
      kind: 'project',
      kept: [],
      removed: [],
      computed: columns.map((c) => c.name),
      renamed: {},
      volatile: volatile || undefined,
      sourceRange: rangeOf(stmt, 'select'),
      caption: captions.projectNoFrom(reference.rows.length),
      output: {
        columns,
        rows: reference.rows.map((values, i) => ({ key: resultKey(i), lineage: {}, values })),
      },
    };
    return finish({ mode: 'full', stages: [stage], result: reference, error: null });
  }

  const from = flattenFrom(sel, opts.schema);
  if (!from.ok) return finalOnly(from.reason);

  const { sources, joins } = from;
  const args = { stmt, sel, prober, reference, volatile, sources, joins, schema: opts.schema };
  let ctx = createSelectCtx(args);
  let compressed = false;
  try {
    try {
      await runSelect(ctx);
    } catch (e) {
      if (!(e instanceof ProbeOverflow)) throw e;
      ctx = createSelectCtx(args);
      compressed = true;
      await runCompressed(ctx);
    }
  } catch (e) {
    if (e instanceof TraceFallback) return finalOnly(e.message);
    if (!(e instanceof DbException)) throw e;
    return finalOnly(`Проба не удалась: ${e.db.message}`);
  }
  if (compressed) {
    const ok = ctx.stages.at(-1)?.rowCount === reference.rows.length;
    return ok
      ? finish({ mode: 'full', stages: ctx.stages, result: reference, error: null })
      : finalOnly('Сверка с прямым выполнением не сошлась');
  }

  // Принцип честности: финальная стадия обязана совпасть с прямым выполнением.
  // Volatile-колонки в сверку не входят: проба P и эталон считают их по-разному
  const last = ctx.stages[ctx.stages.length - 1];
  const orderKeys = ctx.sel.sortClause ? (await ctx.ordered()).orderKeys : null;
  const ok = sameResult(last.output, reference, orderKeys, stableCanon(await ctx.outputs()));
  if (!ok) {
    if (import.meta.env?.DEV) console.warn('[tracer] сверка не сошлась', stmt.text);
    return finalOnly('Сверка с прямым выполнением не сошлась');
  }
  return finish({ mode: 'full', stages: ctx.stages, result: reference, error: null });
}
