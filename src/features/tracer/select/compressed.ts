import type { Node } from '@pgsql/types';
import { captions, limitLabel } from '../captions';
import { ident, sqlOf } from '../probe';
import type { Column, Stage } from '../types';
import { rangeOf, type SelectCtx, stageId } from './context';
import { groupCaption, groupParts, groupStep, setGroupColumns } from './group';
import { joinLayout } from './join';
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

  let n = 0;
  for (const [i, { alias, table }] of ctx.sources.entries()) {
    const head = await ctx.prober.run(`SELECT ${ident(alias)}.*${sql.fromSource(i)} LIMIT 0`);
    const types = await ctx.typeNames(head.fields.map((f) => f.dataTypeID));
    const cols = head.fields.map((f) => ({
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
      source: { alias, column: f.name },
    }));
    ctx.sourceColumns.push(cols);
    ctx.scanColumns.push(...cols.map((c) => c.name));
    ctx.columns = cols;
    n = await count(`SELECT 1${sql.fromSource(i)}`);
    ctx.stages.push({
      ...base('scan', cols),
      kind: 'scan',
      alias,
      tableId: table.id,
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'from'),
      caption: captions.scan(table.name, alias, n),
    });
  }
  for (const [k, j] of ctx.joins.entries()) {
    const cols = joinLayout(ctx, k).columns;
    ctx.columns = cols;
    n = await count(`SELECT 1${sql.fromUpTo(k)}`);
    ctx.stages.push({
      ...base('join', cols),
      kind: 'join',
      joinType: j.jointype,
      leftAliases: ctx.aliasOrder.slice(0, k + 1),
      rightAlias: j.right.alias,
      pairs: [],
      onColumns: [],
      usingColumns: j.using ?? [],
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'from'),
      caption: captions.joinCompressed(j.jointype.toUpperCase(), n),
    });
  }
  const scanCols = ctx.sourceColumns.flat();

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

  if (groupStep.applies(ctx)) {
    const parts = groupParts(ctx);
    const head = await ctx.prober.run(`SELECT ${parts.select}${sql.from}${sql.group} LIMIT 0`);
    await setGroupColumns(ctx, parts, head.fields, []);
    const before = n;
    n = await count(`SELECT 1${sql.from}${sql.where}${sql.group}`);
    ctx.stages.push({
      ...base('group', ctx.columns),
      kind: 'group',
      keys: parts.keys,
      groups: [],
      aggregates: parts.aggregates,
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, parts.keys.length ? 'group' : 'select'),
      caption: groupCaption(parts.keys, n, before),
    });
  }
  if (sel.havingClause) {
    const before = n;
    sql.group += ` HAVING ${sqlOf(sel.havingClause)}`;
    n = await count(`SELECT 1${sql.from}${sql.where}${sql.group}`);
    ctx.stages.push({
      ...base('filter', ctx.columns),
      kind: 'filter',
      clause: 'having',
      verdicts: {},
      predicateColumns: [],
      rowCount: n,
      sourceRange: rangeOf(ctx.stmt, 'having'),
      caption: captions.having(before, n, 0),
    });
  }

  const out = await ctx.outputs();
  const input = ctx.columns;
  const p = projection(out, input);
  ctx.stages.push({
    ...base('project', out.columns),
    kind: 'project',
    ...p,
    rowCount: n,
    sourceRange: rangeOf(ctx.stmt, 'select'),
    caption: captions.project(out.columns.length - p.computed.length, input.length, p.computed.length),
  });

  if (sel.distinctClause) {
    const nodes = sel.distinctClause as Node[];
    const on = Object.keys(nodes[0]).length ? nodes.map(sqlOf) : null;
    const before = n;
    n = await count(
      `SELECT DISTINCT${on ? ` ON (${on.join(', ')})` : ''} ${sql.targets}${sql.from}${sql.where}${sql.group}`,
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
