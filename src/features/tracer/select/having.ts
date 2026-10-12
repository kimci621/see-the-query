import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { sqlOf } from '../probe';
import type { RowKey } from '../types';
import { walk } from '../whitelist';
import { rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// Колонки группы, на которые смотрит HAVING: ключи и агрегаты, встретившиеся в условии
function havingColumns(having: Node, grouped: { keys: string[]; aggregates: string[]; columns: string[] }) {
  const exprs = [...grouped.keys, ...grouped.aggregates];
  const used = new Set<string>();
  walk(having, (key, value) => {
    if (key !== 'FuncCall' && key !== 'ColumnRef') return;
    const i = exprs.indexOf(sqlOf({ [key]: value } as Node));
    if (i >= 0) used.add(grouped.columns[i]);
  });
  return [...used];
}

// HAVING: вердикты по группам, остаются только true. Дальше все пробы над группами идут с HAVING
export const havingStep: SelectStep = {
  name: 'having',
  applies: (ctx) => Boolean(ctx.sel.havingClause),
  async run(ctx) {
    const having = ctx.sel.havingClause as Node;
    const { sql } = ctx;
    const r = await ctx.prober.rows(
      `SELECT ${sql.rowKey}, (${sqlOf(having)}) AS __vs_pred${sql.from}${sql.where}${sql.group}`,
    );
    const verdicts: Record<RowKey, boolean | null> = {};
    for (const [key, pred] of r.rows) verdicts[key as RowKey] = pred as boolean | null;
    sql.group += ` HAVING ${sqlOf(having)}`;
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => verdicts[row.key] === true);
    ctx.stages.push({
      id: stageId(ctx, 'filter'),
      kind: 'filter',
      clause: 'having',
      verdicts,
      predicateColumns: ctx.grouped ? havingColumns(having, ctx.grouped) : [],
      sourceRange: rangeOf(ctx.stmt, 'having'),
      caption: captions.having(
        before,
        ctx.rows.length,
        Object.values(verdicts).filter((v) => v === null).length,
      ),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
