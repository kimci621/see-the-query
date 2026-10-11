import { captions } from '../captions';
import { keyOf, rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// FROM t: строки таблицы с ctid как lineage
export const scanStep: SelectStep = {
  name: 'scan',
  applies: () => true,
  async run(ctx) {
    const a = ctx.sql.alias;
    const r = await ctx.prober.rows(`SELECT ${ctx.sql.lineage}, ${a}.*${ctx.sql.from} ORDER BY ${a}.ctid`);
    const fields = r.fields.slice(1);
    const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
    ctx.scanColumns = fields.map((f) => f.name);
    ctx.columns = fields.map((f) => ({
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
      source: { alias: ctx.alias, column: f.name },
    }));
    ctx.rows = r.rows.map((row) => ({
      key: keyOf(ctx, row[0] as string),
      lineage: { [ctx.alias]: row[0] as string },
      values: row.slice(1),
    }));
    ctx.stages.push({
      id: stageId(ctx, 'scan'),
      kind: 'scan',
      alias: ctx.alias,
      tableId: ctx.table.id,
      sourceRange: rangeOf(ctx.stmt, 'from'),
      caption: captions.scan(ctx.table.name, ctx.alias, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
