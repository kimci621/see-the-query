import type { SelectStmt, SubLink } from '@pgsql/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { sqlOf, TraceFallback } from '../probe';
import { rangeOf, stageId } from '../select/context';
import type { SelectStep } from '../select/pipeline';
import type { RowKey } from '../types';
import { walk } from '../whitelist';

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
const isIn = (link: SubLink) => link.subLinkType === 'ANY_SUBLINK';
const isScalar = (link: SubLink) => link.subLinkType === 'EXPR_SUBLINK';

async function innerTrace(ctx: Parameters<SelectStep['run']>[0], link: SubLink) {
  if (!ctx.trace) throw new TraceFallback('Пока не анимируется: подзапрос в этом контексте');
  if (!link.subselect || !('SelectStmt' in link.subselect))
    throw new TraceFallback('Пока не анимируется: подзапрос без SELECT');
  const inner = await ctx.trace(childStmt(ctx.stmt, link.subselect.SelectStmt));
  if (inner.mode !== 'full')
    throw new TraceFallback(`Подзапрос не анимируется: ${inner.fallbackReason ?? 'причина не указана'}`);
  return inner;
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
  applies: (ctx) => subLinks(ctx.sel.whereClause).some((link) => isIn(link) || isExists(link)),
  async run(ctx) {
    const links = subLinks(ctx.sel.whereClause).filter((link) => isIn(link) || isExists(link));
    // NOT IN / NOT EXISTS: вердикт подзапроса инвертируется, NULL остаётся UNKNOWN
    const negated = new Set<SubLink>();
    walk(ctx.sel.whereClause, (key, value) => {
      if (key !== 'BoolExpr' || (value as { boolop?: string }).boolop !== 'NOT_EXPR') return;
      walk((value as { args?: unknown }).args, (inner, node) => {
        if (inner === 'SubLink') negated.add(node as SubLink);
      });
    });
    for (const link of links) {
      if (!isIn(link) && !isExists(link)) continue;
      await innerTrace(ctx, link);
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
      ctx.stages.push({
        id: stageId(ctx, 'subquery'),
        kind: 'subquery',
        mode: isExists(link) ? 'exists' : 'in',
        samples: [],
        limit3: false,
        verdicts,
        sourceRange: rangeOf(ctx.stmt, 'where'),
        caption: isExists(link)
          ? captions.subqueryExists(Object.values(verdicts).filter(Boolean).length)
          : captions.subqueryIn(
              Object.values(verdicts).filter((value) => value === true).length,
              Object.values(verdicts).filter((value) => value === null).length,
            ),
        output: { columns: ctx.columns, rows: ctx.rows },
      });
    }
  },
};
