import { captions } from '../captions';
import { alignToReference, rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// ORDER BY: позиции строк из упорядоченной проекции P (ключ ctid последним)
export const sortStep: SelectStep = {
  name: 'sort',
  applies: (ctx) => Boolean(ctx.sel.sortClause),
  async run(ctx) {
    const ordered = await ctx.ordered();
    const present = new Set(ctx.rows.map((r) => r.key));
    let order = ordered.order.filter((k) => present.has(k));
    if (ctx.sel.limitCount || ctx.sel.limitOffset) order = await alignToReference(ctx, order);
    const byKey = new Map(ctx.rows.map((r) => [r.key, r]));
    ctx.rows = order.flatMap((k) => byKey.get(k) ?? []);
    ctx.stages.push({
      id: stageId(ctx, 'sort'),
      kind: 'sort',
      order,
      sortKeys: ordered.sortKeys,
      sourceRange: rangeOf(ctx.stmt, 'order'),
      caption: captions.sort(ordered.sortKeys, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
