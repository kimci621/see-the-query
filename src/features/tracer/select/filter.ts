import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { sqlOf } from '../probe';
import type { RowKey } from '../types';
import { walk } from '../whitelist';
import { rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// WHERE: вердикт true / false / null по каждой строке, остаются только true
export const filterStep: SelectStep = {
  name: 'filter',
  applies: (ctx) => Boolean(ctx.sel.whereClause),
  async run(ctx) {
    const where = ctx.sel.whereClause as Node;
    const r = await ctx.prober.rows(
      `SELECT ${ctx.sql.rowKey}, (${sqlOf(where)}) AS __vs_pred${ctx.sql.from}`,
    );
    const verdicts: Record<RowKey, true | false | null> = {};
    for (const [key, verdict] of r.rows) verdicts[key as RowKey] = verdict as boolean | null;
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => verdicts[row.key] === true);
    const predicateColumns = new Set<string>();
    walk(where, (key, value) => {
      if (key !== 'ColumnRef') return;
      const last = (value as { fields?: Node[] }).fields?.at(-1);
      const name = last && 'String' in last ? last.String.sval : undefined;
      if (name && ctx.scanColumns.includes(name)) predicateColumns.add(name);
    });
    ctx.stages.push({
      id: stageId(ctx, 'filter'),
      kind: 'filter',
      clause: 'where',
      verdicts,
      predicateColumns: [...predicateColumns],
      sourceRange: rangeOf(ctx.stmt, 'where'),
      caption: captions.filter(
        before,
        ctx.rows.length,
        Object.values(verdicts).filter((v) => v === null).length,
      ),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
