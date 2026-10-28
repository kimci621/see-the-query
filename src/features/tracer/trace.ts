import type { Node } from '@pgsql/types';
import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from './captions';
import type { Prober } from './probe';
import { createProber, ProbeOverflow, sqlOf, TraceFallback, typeNames } from './probe';
import { traceSpecial } from './route';
import { resultKey } from './rowkey';
import { runCompressed } from './select/compressed';
import { createSelectCtx, type Ordered, rangeOf, type SelectCtx, stableCanon } from './select/context';
import { filterStep } from './select/filter';
import { groupStep } from './select/group';
import { flattenFrom, joinStep } from './select/join';
import { runSelect } from './select/pipeline';
import { scanStep } from './select/scan';
import type { Relation, Stage, Trace, TraceOptions } from './types';
import { rowCanon, sameResult } from './verify';
import { groupingErrorFocus, selectFeatures, touchedOf, unsupportedReason, volatileSort } from './whitelist';

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

  // Операторы Ф9 сами выполняют эталон одним прогоном с расширенным RETURNING.
  const special = await traceSpecial(stmt, db, prober, opts, traceStatement);
  if (special !== null && typeof special !== 'string') return finish(special);

  // Эталон: оператор как есть. Ошибка Postgres → стадия error
  let reference: QueryResult;
  try {
    reference = await prober.run(stmt.text);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    const error = e.db;
    const focus = error.code === '42803' ? groupingErrorFocus(error.message, stmt.ast, opts.schema) : null;
    const before = focus ? await groupingStages(stmt, prober, opts.schema) : { stages: [] };
    const stage: Stage = {
      id: `${before.stages.length}:error`,
      kind: 'error',
      error,
      focus: focus ?? touched,
      ...('group' in before ? { group: before.group } : {}),
      caption: captions.error(error.code, error.message),
      output: { columns: [], rows: [] },
    };
    return finish({
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [...before.stages, stage],
      result: null,
      error,
    });
  }
  const finalOnly = (fallbackReason: string) =>
    finish({ mode: 'final-only', fallbackReason, stages: [], result: reference, error: null });

  if (typeof special === 'string') return finalOnly(special);
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
  let compressed: QueryResult | null = null;
  try {
    try {
      await runSelect(ctx);
    } catch (e) {
      if (!(e instanceof ProbeOverflow)) throw e;
      ctx = createSelectCtx(args);
      compressed = await runCompressed(ctx);
    }
  } catch (e) {
    if (e instanceof TraceFallback) return finalOnly(e.message);
    if (!(e instanceof DbException)) throw e;
    return finalOnly(`Проба не удалась: ${e.db.message}`);
  }
  if (compressed) {
    // Строк на стадиях нет, сверяем итог по тем же фрагментам, что и счётчики. С volatile-ключом порядок
    // случаен и на стадиях не показан (с LIMIT это уже final-only): хватает мультимножества
    const rows = compressed.rows.map((values, i) => ({ key: resultKey(i), lineage: {}, values }));
    const orderKeys = !ctx.sel.sortClause || volatileSort(ctx.sel) ? null : 'rows';
    const ok =
      ctx.stages.at(-1)?.rowCount === reference.rows.length &&
      sameResult({ columns: [], rows }, reference, orderKeys, stableCanon(await ctx.outputs()));
    return ok
      ? finish({ mode: 'full', stages: ctx.stages, result: reference, error: null })
      : finalOnly('Сверка с прямым выполнением не сошлась');
  }

  // Принцип честности: финальная стадия обязана совпасть с прямым выполнением.
  // Volatile-колонки в сверку не входят: проба P и эталон считают их по-разному
  const last = ctx.stages[ctx.stages.length - 1];
  // Без volatile-ключей порядок сверяется целиком: и по ключам вне выхода, и по выражениям
  const ordered = ctx.sel.sortClause && volatileSort(ctx.sel) ? await ctx.ordered() : null;
  const orderKeys = !ctx.sel.sortClause ? null : ordered ? ordered.orderKeys : 'rows';
  const canonOf = stableCanon(await ctx.outputs());
  const hidden = Boolean(ordered?.hidden.length);
  let ok = sameResult(last.output, reference, hidden ? null : orderKeys, canonOf);
  if (ok && ordered && hidden) ok = await sameSeries(ctx, last.output, ordered, canonOf);
  if (!ok) {
    if (import.meta.env?.DEV) console.warn('[tracer] сверка не сошлась', stmt.text);
    return finalOnly('Сверка с прямым выполнением не сошлась');
  }
  return finish({ mode: 'full', stages: ctx.stages, result: reference, error: null });
}

// Volatile-ключ после ключа вне выхода (order by price, random()): эталон ещё раз, с этими ключами
// скрытыми колонками в конце, и серии сверяются по ним. Целый SelectStmt здесь депарсить можно:
// volatile в ORDER BY с LIMIT уже final-only, терять WITH TIES нечего
async function sameSeries(
  ctx: SelectCtx,
  output: Relation,
  ordered: Ordered,
  canonOf: (values: unknown[]) => string,
): Promise<boolean> {
  const n = (await ctx.outputs()).columns.length;
  const targetList = [
    ...(ctx.sel.targetList ?? []),
    ...ordered.hidden.map((val): Node => ({ ResTarget: { val } })),
  ];
  let keyed: QueryResult;
  try {
    keyed = await ctx.prober.run(sqlOf({ SelectStmt: { ...ctx.sel, targetList } }));
  } catch (e) {
    if (e instanceof DbException) return false;
    throw e;
  }
  const rows = output.rows.map((r) => ({
    ...r,
    values: [...r.values, ...(ordered.hiddenValues.get(r.key) ?? [])],
  }));
  const withHidden = (values: unknown[]) =>
    `${canonOf(values.slice(0, n))}\u0003${rowCanon(values.slice(n))}`;
  return sameResult({ ...output, rows }, keyed, ordered.orderKeys, withHidden);
}

// 42803 «must appear»: стадии до GROUP BY настоящими пробами и состав групп, чтобы показать колонку в стопке.
// Не вышло (сложный FROM, volatile, переполнение, ошибка пробы): только стадия ошибки
async function groupingStages(
  stmt: ParsedStatement,
  prober: Prober,
  schema: TraceOptions['schema'],
): Promise<{ stages: Stage[]; group?: Extract<Stage, { kind: 'error' }>['group'] }> {
  const sel = 'SelectStmt' in stmt.ast ? stmt.ast.SelectStmt : null;
  if (!sel?.fromClause || !sel.groupClause || unsupportedReason(stmt) !== null) return { stages: [] };
  if (selectFeatures(sel).has('volatile')) return { stages: [] };
  const from = flattenFrom(sel, schema);
  if (!from.ok) return { stages: [] };
  const reference = { fields: [], rows: [] };
  const ctx = createSelectCtx({ stmt, sel, prober, reference, volatile: false, ...from, schema });
  try {
    for (const step of [scanStep, joinStep, filterStep, groupStep])
      if (step.applies(ctx)) await step.run(ctx);
  } catch (e) {
    if (e instanceof ProbeOverflow || e instanceof TraceFallback || e instanceof DbException)
      return { stages: [] };
    throw e;
  }
  const g = ctx.stages.pop();
  return g?.kind === 'group'
    ? { stages: ctx.stages, group: { keys: g.keys, keyColumns: g.keyColumns, groups: g.groups } }
    : { stages: [] };
}
