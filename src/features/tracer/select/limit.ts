import { captions, limitLabel } from '../captions';
import { alignToReference, rangeOf, stageId, windowOf } from './context';
import type { SelectStep } from './pipeline';

// LIMIT / OFFSET / FETCH FIRST: окно над текущим порядком строк
export const limitStep: SelectStep = {
  name: 'limit',
  applies: (ctx) => Boolean(ctx.sel.limitCount || ctx.sel.limitOffset),
  async run(ctx) {
    let keys = ctx.rows.map((r) => r.key);
    // Без ORDER BY порядок не задан: строки окна берём те, что вернул Postgres
    if (!ctx.sel.sortClause) keys = await alignToReference(ctx, keys);
    const { from, to } = await windowOf(ctx, keys);
    const { limit, offset, withTies } = await ctx.limitParams();
    const kept = keys.slice(from, to);
    const keptSet = new Set(kept);
    const byKey = new Map(ctx.rows.map((r) => [r.key, r]));
    const before = ctx.rows.length;
    ctx.rows = kept.flatMap((k) => byKey.get(k) ?? []);
    ctx.stages.push({
      id: stageId(ctx, 'limit'),
      kind: 'limit',
      kept,
      cut: keys.filter((k) => !keptSet.has(k)),
      limit,
      offset,
      withTies,
      volatile: ctx.volatile || undefined,
      sourceRange: rangeOf(ctx.stmt, 'limit', 'offset'),
      caption: captions.limit(limitLabel(limit, offset, withTies), before, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
