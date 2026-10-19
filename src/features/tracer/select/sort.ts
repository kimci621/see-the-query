import { captions } from '../captions';
import { alignToReference, rangeOf, sortKeyColumns, stageId } from './context';
import type { SelectStep } from './pipeline';

// ORDER BY: позиции строк из упорядоченной проекции P (ключ ctid последним)
export const sortStep: SelectStep = {
  name: 'sort',
  applies: (ctx) => Boolean(ctx.sel.sortClause),
  async run(ctx) {
    const ordered = await ctx.ordered();
    const present = new Set(ctx.rows.map((r) => r.key));
    // Равные по ключам строки ставим так же, как Postgres в эталоне (без LIMIT окно это все строки)
    const order = await alignToReference(
      ctx,
      ordered.order.filter((k) => present.has(k)),
    );
    const byKey = new Map(ctx.rows.map((r) => [r.key, r]));
    ctx.rows = order.flatMap((k) => byKey.get(k) ?? []);
    ctx.stages.push({
      id: stageId(ctx, 'sort'),
      kind: 'sort',
      order,
      sortKeys: ordered.sortKeys,
      keyColumns: sortKeyColumns(ctx, await ctx.outputs()),
      volatile: ctx.volatile || undefined,
      sourceRange: rangeOf(ctx.stmt, 'order'),
      caption: captions.sort(ordered.sortKeys, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
