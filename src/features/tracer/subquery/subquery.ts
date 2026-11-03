import type { A_Const, SelectStmt, SubLink } from '@pgsql/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { sqlOf, TraceFallback } from '../probe';
import { rangeOf, stageId } from '../select/context';
import type { SelectStep } from '../select/pipeline';
import type { RowKey } from '../types';
import { findTable, walk } from '../whitelist';

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

function literal(value: unknown): A_Const {
  if (value === null || value === undefined) return { isnull: true };
  if (typeof value === 'boolean') return { boolval: { boolval: value } };
  if (typeof value === 'number')
    return Number.isSafeInteger(value) ? { ival: { ival: value } } : { fval: { fval: String(value) } };
  if (value instanceof Date) return { sval: { sval: value.toISOString() } };
  if (typeof value === 'object') return { sval: { sval: JSON.stringify(value) } };
  return { sval: { sval: String(value) } };
}

interface InnerNames {
  aliases: Set<string>;
  columns: Set<string>;
}

function innerNames(ctx: Parameters<SelectStep['run']>[0], sel: SelectStmt): InnerNames {
  const aliases = new Set<string>();
  const columns = new Set<string>();
  walk(sel, (key, value) => {
    if (key !== 'RangeVar') return;
    const rv = value as { schemaname?: string; relname?: string; alias?: { aliasname?: string } };
    const table = rv.relname ? findTable(ctx.schema, rv.schemaname, rv.relname) : null;
    if (!table) return;
    aliases.add(rv.alias?.aliasname ?? table.name);
    for (const column of table.columns) columns.add(column.name);
  });
  return { aliases, columns };
}

function outerValues(ctx: Parameters<SelectStep['run']>[0], row: { values: unknown[] }) {
  const qualified = new Map<string, unknown>();
  const bare = new Map<string, { value: unknown; count: number }>();
  ctx.columns.forEach((column, i) => {
    if (!column.source) return;
    const value = row.values[i];
    qualified.set(`${column.source.alias}.${column.source.column}`, value);
    const found = bare.get(column.source.column);
    if (found) found.count++;
    else bare.set(column.source.column, { value, count: 1 });
  });
  for (const [name, item] of bare) if (item.count === 1) qualified.set(name, item.value);
  return qualified;
}

// Подстановка значений внешней строки: ColumnRef на внешний алиас заменяется литералом
function substituteOuter(
  node: unknown,
  outer: Map<string, unknown>,
  inner: InnerNames,
): { ast: unknown; count: number } {
  let count = 0;
  const walkNode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walkNode);
    if (!value || typeof value !== 'object') return value;
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if ('ColumnRef' in copy) {
      const fields = (copy.ColumnRef as { fields?: Array<{ String?: { sval?: string } }> }).fields ?? [];
      const names = fields.flatMap((field) => (field.String?.sval ? [field.String.sval] : []));
      const column = names.at(-1);
      const qualifier = names.length > 1 ? names.at(-2) : undefined;
      const key = qualifier
        ? inner.aliases.has(qualifier)
          ? undefined
          : `${qualifier}.${column}`
        : column && !inner.columns.has(column)
          ? column
          : undefined;
      if (key && outer.has(key)) {
        count++;
        return { A_Const: literal(outer.get(key)) };
      }
    }
    for (const [key, item] of Object.entries(copy)) copy[key] = walkNode(item);
    return copy;
  };
  return { ast: walkNode(node), count };
}

async function correlatedSamples(
  ctx: Parameters<SelectStep['run']>[0],
  link: SubLink,
): Promise<Array<{ outer: RowKey; inner: import('../types').Trace }> | null> {
  if (!ctx.trace || !link.subselect || !('SelectStmt' in link.subselect)) return null;
  const sel = link.subselect.SelectStmt;
  const inner = innerNames(ctx, sel);
  const samples: Array<{ outer: RowKey; inner: import('../types').Trace }> = [];
  let replaced = 0;
  for (const row of ctx.rows.slice(0, 3)) {
    const { ast, count } = substituteOuter(sel, outerValues(ctx, row), inner);
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
    subLinks(ctx.sel.whereClause).some((link) => isIn(link) || isExists(link) || isScalar(link)),
  async run(ctx) {
    const links = subLinks(ctx.sel.whereClause).filter(
      (link) => isIn(link) || isExists(link) || isScalar(link),
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
      ctx.stages.push({
        id: stageId(ctx, 'subquery'),
        kind: 'subquery',
        mode: isExists(link) ? 'exists' : 'in',
        samples: samples ?? [],
        limit3: Boolean(samples?.length),
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
