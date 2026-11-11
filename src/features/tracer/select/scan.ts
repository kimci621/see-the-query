import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
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
      if (source.srf) {
        const r = await ctx.prober.run(`SELECT ${a}.*${ctx.sql.fromUpTo(i - 1)} LIMIT 0`);
        const fields = source.srf.ordinalVisible ? r.fields : r.fields.slice(0, -1);
        const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
        const columns = fields.map((f) => ({
          name: f.name,
          type: types.get(f.dataTypeID) ?? 'unknown',
          source: { alias, column: f.name },
        }));
        ctx.sourceColumns.push(columns);
        ctx.scanColumns.push(...columns.map((c) => c.name));
        continue;
      }
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
    if (ctx.sources.some((source) => source.srf)) {
      ctx.sql.targets = (ctx.sel.targetList ?? [])
        .flatMap((target) => {
          const val = 'ResTarget' in target ? target.ResTarget.val : undefined;
          const fields = val && 'ColumnRef' in val ? val.ColumnRef.fields : undefined;
          if (!fields?.length || !('A_Star' in fields[fields.length - 1])) return [sqlOf(target)];
          const first = fields.length === 2 ? fields[0] : undefined;
          const alias = first && 'String' in first ? first.String.sval : undefined;
          return ctx.sources.flatMap((source, i) =>
            alias && alias !== source.alias
              ? []
              : ctx.sourceColumns[i].map((column) => `${ident(source.alias)}.${ident(column.name)}`),
          );
        })
        .join(', ');
    }
  },
};
