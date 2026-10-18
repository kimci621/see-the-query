import { captions } from '../captions';
import { ident } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Row } from '../types';
import { rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// FROM: стадия на каждый источник, строки таблицы с ctid как lineage
export const scanStep: SelectStep = {
  name: 'scan',
  applies: () => true,
  async run(ctx) {
    for (const [i, source] of ctx.sources.entries()) {
      const { alias, table } = source;
      const a = ident(alias);
      const r = await ctx.prober.rows(
        `SELECT ${a}.ctid::text, ${a}.*${ctx.sql.fromSource(i)} ORDER BY ${a}.ctid`,
      );
      const fields = r.fields.slice(1);
      const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
      const columns = fields.map((f) => ({
        name: f.name,
        type: types.get(f.dataTypeID) ?? 'unknown',
        source: { alias, column: f.name },
      }));
      ctx.sourceColumns.push(columns);
      ctx.scanColumns.push(...columns.map((c) => c.name));
      const rows = r.rows.map(
        (row): Row => ({
          key: rowKeyOf({ [alias]: row[0] as string }, [alias]),
          lineage: { [alias]: row[0] as string },
          values: row.slice(1),
        }),
      );
      // Без JOIN строки скана идут дальше по пайплайну; с JOIN их заменит join-стадия
      ctx.columns = columns;
      ctx.rows = rows;
      ctx.stages.push({
        id: stageId(ctx, 'scan'),
        kind: 'scan',
        alias,
        tableId: table.id,
        sourceRange: rangeOf(ctx.stmt, 'from'),
        caption: captions.scan(table.name, alias, rows.length),
        output: { columns, rows },
      });
    }
  },
};
