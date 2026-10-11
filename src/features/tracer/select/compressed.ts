import type { Node } from '@pgsql/types';
import { captions, limitLabel } from '../captions';
import { sqlOf } from '../probe';
import type { Column, Stage } from '../types';
import { rangeOf, type SelectCtx, stageId } from './context';
import { projection } from './project';

// Сжатый режим: таблица больше maxRows. Стадии без строк, только точные счётчики (оверлей рисует полосы)
export async function runCompressed(ctx: SelectCtx): Promise<void> {
  const { sql, sel } = ctx;
  const count = async (q: string) =>
    Number((await ctx.prober.run(`SELECT count(*) FROM (${q}) AS __vs_c`)).rows[0][0]);
  const base = (kind: Stage['kind'], columns: Column[]) => ({
    id: stageId(ctx, kind),
    compressed: true,
    output: { columns, rows: [] },
  });

  const head = await ctx.prober.run(`SELECT ${sql.alias}.*${sql.from} LIMIT 0`);
  const types = await ctx.typeNames(head.fields.map((f) => f.dataTypeID));
  ctx.scanColumns = head.fields.map((f) => f.name);
  const scanCols = head.fields.map((f) => ({
    name: f.name,
    type: types.get(f.dataTypeID) ?? 'unknown',
    source: { alias: ctx.alias, column: f.name },
  }));
  let n = await count(`SELECT 1${sql.from}`);
  ctx.stages.push({
    ...base('scan', scanCols),
    kind: 'scan',
    alias: ctx.alias,
    tableId: ctx.table.id,
    rowCount: n,
    sourceRange: rangeOf(ctx.stmt, 'from'),
    caption: captions.scan(ctx.table.name, ctx.alias, n),
  });

  if (sel.whereClause) {
    const before = n;
    n = await count(`SELECT 1${sql.from}${sql.where}`);
    ctx.stages.push({
      ...base('filter', scanCols),
      kind: 'filter',
      clause: 'where',
      verdicts: {},
      predicateColumns: [],
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'where'),
      caption: captions.filter(before, n, 0),
    });
  }

  const out = await ctx.outputs();
  const p = projection(out, ctx.scanColumns);
  ctx.stages.push({
    ...base('project', out.columns),
    kind: 'project',
    ...p,
    rowCount: n,
    sourceRange: rangeOf(ctx.stmt, 'select'),
    caption: captions.project(
      p.kept.length + Object.keys(p.renamed).length,
      ctx.scanColumns.length,
      p.computed.length,
    ),
  });

  if (sel.distinctClause) {
    const nodes = sel.distinctClause as Node[];
    const on = Object.keys(nodes[0]).length ? nodes.map(sqlOf) : null;
    const before = n;
    n = await count(
      `SELECT DISTINCT${on ? ` ON (${on.join(', ')})` : ''} ${sql.targets}${sql.from}${sql.where}`,
    );
    ctx.stages.push({
      ...base('distinct', out.columns),
      kind: 'distinct',
      on,
      stacks: [],
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: on ? captions.distinctOn(on, before, n) : captions.distinct(before, n),
    });
  }
  if (sel.sortClause) {
    const sortKeys = sel.sortClause.map(sqlOf);
    ctx.stages.push({
      ...base('sort', out.columns),
      kind: 'sort',
      order: [],
      sortKeys,
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'order'),
      caption: captions.sort(sortKeys, n),
    });
  }
  if (sel.limitCount || sel.limitOffset) {
    const { limit, offset, withTies } = await ctx.limitParams();
    const before = n;
    // Итог окна (в том числе WITH TIES) берём у прямого выполнения
    n = ctx.reference.rows.length;
    ctx.stages.push({
      ...base('limit', out.columns),
      kind: 'limit',
      kept: [],
      cut: [],
      limit,
      offset,
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'limit', 'offset'),
      caption: captions.limit(limitLabel(limit, offset, withTies), before, n),
    });
  }
}
