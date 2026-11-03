import type { SelectStmt, SubLink } from '@pgsql/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { sqlOf, TraceFallback } from '../probe';
import { rangeOf, stageId } from '../select/context';
import type { SelectStep } from '../select/pipeline';
import type { RowKey } from '../types';
import { walk } from '../whitelist';
import { innerNames, outerValues, substituteOuter } from './substitute';

function childStmt(parent: ParsedStatement, sel: SelectStmt): ParsedStatement {
  return {
    index: parent.index,
    from: parent.from,
    to: parent.to,
    byteFrom: parent.byteFrom,
    text: sqlOf({ SelectStmt: sel }),
    ast: { SelectStmt: sel },
    kind: 'select',
  };
}

function subLinks(node: unknown): SubLink[] {
  const found: SubLink[] = [];
  walk(node, (key, value) => {
    if (key === 'SubLink') found.push(value as SubLink);
  });
  return found;
}

const isExists = (link: SubLink) => link.subLinkType === 'EXISTS_SUBLINK';
const isIn = (link: SubLink) => link.subLinkType === 'ANY_SUBLINK' && !link.operName?.length;
const isAny = (link: SubLink) => link.subLinkType === 'ANY_SUBLINK' && Boolean(link.operName?.length);
const isAll = (link: SubLink) => link.subLinkType === 'ALL_SUBLINK';
const isScalar = (link: SubLink) => link.subLinkType === 'EXPR_SUBLINK';
const isCompare = (link: SubLink) => isIn(link) || isAny(link) || isAll(link);

async function innerTrace(ctx: Parameters<SelectStep['run']>[0], link: SubLink) {
  if (!ctx.trace) throw new TraceFallback('Пока не анимируется: подзапрос в этом контексте');
  if (!link.subselect || !('SelectStmt' in link.subselect))
    throw new TraceFallback('Пока не анимируется: подзапрос без SELECT');
  const inner = await ctx.trace(childStmt(ctx.stmt, link.subselect.SelectStmt));
  if (inner.mode !== 'full')
    throw new TraceFallback(`Подзапрос не анимируется: ${inner.fallbackReason ?? 'причина не указана'}`);
  return inner;
}

async function correlatedSamples(
  ctx: Parameters<SelectStep['run']>[0],
  link: SubLink,
): Promise<Array<{ outer: RowKey; inner: import('../types').Trace }> | null> {
  if (!ctx.trace || !link.subselect || !('SelectStmt' in link.subselect)) return null;
  const sel = link.subselect.SelectStmt;
  const inner = innerNames(ctx.schema, sel);
  const samples: Array<{ outer: RowKey; inner: import('../types').Trace }> = [];
  let replaced = 0;
  for (const row of ctx.rows.slice(0, 3)) {
    const { ast, count } = substituteOuter(sel, outerValues(ctx.columns, row.values), inner);
    if (!count) return null;
    replaced += count;
    const innerTrace = await ctx.trace(childStmt(ctx.stmt, ast as SelectStmt));
    if (innerTrace.mode !== 'full')
      throw new TraceFallback(
        `Коррелированный подзапрос не анимируется: ${innerTrace.fallbackReason ?? 'причина не указана'}`,
      );
    samples.push({ outer: row.key, inner: innerTrace });
  }
  return replaced ? samples : null;
}

// Скалярный подзапрос в SELECT: значение берём из вложенной трассы, сцена показывает одно число
export const selectSubqueryStep: SelectStep = {
  name: 'select-subquery',
  applies: (ctx) => subLinks(ctx.sel.targetList ?? []).some(isScalar),
  async run(ctx) {
    for (const link of subLinks(ctx.sel.targetList ?? []).filter(isScalar)) {
      const inner = await innerTrace(ctx, link);
      const value = inner.result?.rows[0]?.[0] ?? inner.stages.at(-1)?.output.rows[0]?.values[0];
      ctx.stages.push({
        id: stageId(ctx, 'subquery'),
        kind: 'subquery',
        mode: 'scalar',
        samples: [],
        limit3: false,
        value,
        sourceRange: rangeOf(ctx.stmt, 'select'),
        caption: captions.subqueryScalar(value),
        output: { columns: ctx.columns, rows: ctx.rows },
      });
    }
  },
};

// IN / EXISTS в WHERE: вердикты по каждой строке входа считает Postgres, подзапрос идёт вложенной трассой
export const whereSubqueryStep: SelectStep = {
  name: 'where-subquery',
  applies: (ctx) =>
    subLinks(ctx.sel.whereClause).some((link) => isCompare(link) || isExists(link) || isScalar(link)),
  async run(ctx) {
    const links = subLinks(ctx.sel.whereClause).filter(
      (link) => isCompare(link) || isExists(link) || isScalar(link),
    );
    // NOT IN / NOT EXISTS: вердикт подзапроса инвертируется, NULL остаётся UNKNOWN
    const negated = new Set<SubLink>();
    walk(ctx.sel.whereClause, (key, value) => {
      if (key !== 'BoolExpr' || (value as { boolop?: string }).boolop !== 'NOT_EXPR') return;
      walk((value as { args?: unknown }).args, (inner, node) => {
        if (inner === 'SubLink') negated.add(node as SubLink);
      });
    });
    for (const link of links) {
      const samples = await correlatedSamples(ctx, link);
      const inner = samples ? null : await innerTrace(ctx, link);
      if (isScalar(link)) {
        const value = inner?.result?.rows[0]?.[0];
        ctx.stages.push({
          id: stageId(ctx, 'subquery'),
          kind: 'subquery',
          mode: samples ? 'correlated' : 'scalar',
          samples: samples ?? [],
          limit3: Boolean(samples?.length),
          value,
          sourceRange: rangeOf(ctx.stmt, 'where'),
          caption: samples
            ? `Коррелированный подзапрос: ${samples.length} строки`
            : captions.subqueryScalar(value),
          output: { columns: ctx.columns, rows: ctx.rows },
        });
        continue;
      }
      const r = await ctx.prober.rows(
        `SELECT ${ctx.sql.rowKey}, (${sqlOf({ SubLink: link })}) AS __vs_v${ctx.sql.from}`,
      );
      const verdicts: Record<RowKey, true | false | null> = {};
      for (const [key, verdict] of r.rows) verdicts[key as RowKey] = verdict as boolean | null;
      if (negated.has(link))
        for (const key of Object.keys(verdicts)) {
          const value = verdicts[key];
          verdicts[key] = value === null ? null : !value;
        }
      const yes = Object.values(verdicts).filter((value) => value === true).length;
      const unknown = Object.values(verdicts).filter((value) => value === null).length;
      const label = isAny(link) ? 'ANY' : isAll(link) ? 'ALL' : 'IN';
      ctx.stages.push({
        id: stageId(ctx, 'subquery'),
        kind: 'subquery',
        mode: isExists(link) ? 'exists' : isAll(link) ? 'all' : isAny(link) ? 'any' : 'in',
        samples: samples ?? [],
        limit3: Boolean(samples?.length),
        verdicts,
        sourceRange: rangeOf(ctx.stmt, 'where'),
        caption: isExists(link)
          ? captions.subqueryExists(yes)
          : isIn(link)
            ? captions.subqueryIn(yes, unknown)
            : captions.subqueryAnyAll(label, yes, unknown),
        output: { columns: ctx.columns, rows: ctx.rows },
      });
    }
  },
};
