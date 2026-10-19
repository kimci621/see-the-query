import type { FuncCall, Node, SelectStmt } from '@pgsql/types';
import { DbException } from '@/features/db/types';
import { captions } from '../captions';
import { ident, sqlOf, TraceFallback } from '../probe';
import { groupKey } from '../rowkey';
import type { RowKey } from '../types';
import { AGGREGATES, funcName, walk } from '../whitelist';
import { rangeOf, refColumns, type SelectCtx, stageId } from './context';
import type { SelectStep } from './pipeline';

// Уникальные агрегатные вызовы из SELECT и HAVING в порядке появления
function aggregateCalls(sel: SelectStmt): FuncCall[] {
  const out = new Map<string, FuncCall>();
  walk([sel.targetList, sel.havingClause], (key, value) => {
    if (key !== 'FuncCall') return;
    const fc = value as FuncCall;
    if (fc.over || !(fc.agg_star || AGGREGATES.has(funcName(fc)))) return;
    const text = sqlOf({ FuncCall: fc });
    if (!out.has(text)) out.set(text, fc);
  });
  return [...out.values()];
}

export function aggregateExprs(sel: SelectStmt): string[] {
  return aggregateCalls(sel).map((fc) => sqlOf({ FuncCall: fc }));
}

// Агрегаты над одной колонкой, которые пропускают NULL: count(col), sum(col) и т. п.
const NULL_SKIPPING = new Set(['count', 'sum', 'avg', 'min', 'max']);

// Ключи GROUP BY выражениями и ' GROUP BY …' для всех проб над группами
export function groupParts(ctx: SelectCtx) {
  const targets = (ctx.sel.targetList ?? []).map((n) => ('ResTarget' in n ? n.ResTarget : {}));
  const nodes = (ctx.sel.groupClause ?? []).map((node): Node => {
    if ('GroupingSet' in node) throw new TraceFallback('Пока не анимируется: GROUPING SETS, ROLLUP и CUBE');
    // GROUP BY 1 и GROUP BY <имя выхода>: Postgres берёт выражение из SELECT, если такой входной колонки нет
    const pos = 'A_Const' in node && node.A_Const.ival ? (node.A_Const.ival.ival ?? 0) : null;
    const fields = 'ColumnRef' in node ? node.ColumnRef.fields : undefined;
    const name = fields?.length === 1 && 'String' in fields[0] ? fields[0].String.sval : undefined;
    const target =
      pos !== null
        ? targets[pos - 1]
        : name && !ctx.scanColumns.includes(name)
          ? targets.find((t) => t.name === name)
          : undefined;
    return target?.val ?? node;
  });
  const keys = nodes.map(sqlOf);
  const calls = aggregateCalls(ctx.sel);
  const aggregates = calls.map((fc) => sqlOf({ FuncCall: fc }));
  ctx.sql.group = keys.length ? ` GROUP BY ${keys.join(', ')}` : '';
  // Колонки входа под ключами и в агрегатах считаются до setGroupColumns: потом ctx.columns это колонки групп
  const keyColumns = refColumns(ctx, nodes, ctx.columns);
  const aggregateColumns = refColumns(ctx, calls, ctx.columns);
  const skipping = calls.flatMap((fc) => {
    const arg = fc.args?.length === 1 && !fc.agg_star ? fc.args[0] : undefined;
    return arg && 'ColumnRef' in arg && NULL_SKIPPING.has(funcName(fc)) ? [arg] : [];
  });
  const nullSkipColumns = refColumns(ctx, skipping, ctx.columns);
  // Колонка агрегата называется алиасом из SELECT (count(*) AS all_rows), иначе две колонки count не различить
  const named = aggregates.map((a) => {
    const alias = targets.find((t) => t.name && t.val && sqlOf(t.val) === a)?.name;
    return alias ? `${a} AS ${ident(alias)}` : a;
  });
  return {
    keys,
    keyColumns,
    aggregates,
    aggregateColumns,
    nullSkipColumns,
    select: [...keys, ...named].join(', '),
  };
}

// Колонки группы и ключ строки над группами: номер группы ищется по тексту ROW(ключи)
export async function setGroupColumns(
  ctx: SelectCtx,
  parts: { keys: string[]; aggregates: string[] },
  fields: Array<{ name: string; dataTypeID: number }>,
  rowTexts: string[],
): Promise<void> {
  const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
  ctx.columns = fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown' }));
  ctx.grouped = { ...parts, columns: ctx.columns.map((c) => c.name) };
  const list = rowTexts.map((t) => `'${t.replaceAll("'", "''")}'`).join(', ');
  ctx.sql.rowKey = parts.keys.length
    ? `concat('g:', array_position(ARRAY[${list}]::text[], ROW(${parts.keys.join(', ')})::text) - 1)`
    : `'g:0'`;
}

// Без GROUP BY: значения агрегатов «набегают» по строкам. Считает Postgres окном в порядке стопки.
// Агрегат, который окном не считается (DISTINCT, WITHIN GROUP), или несовпадение с итогом: набегания нет
async function runningValues(ctx: SelectCtx, aggregates: string[], ctids: string, totals: unknown[]) {
  const over = `OVER (ORDER BY ${ctids} ROWS UNBOUNDED PRECEDING)`;
  try {
    const r = await ctx.prober.rows(
      `SELECT ${aggregates.map((a) => `${a} ${over}`).join(', ')}${ctx.sql.from}${ctx.sql.where} ORDER BY ${ctids}`,
    );
    const last = r.rows.at(-1);
    return last && aggregates.every((_, i) => String(last[i]) === String(totals[i])) ? r.rows : undefined;
  } catch (e) {
    if (e instanceof DbException) return undefined;
    throw e;
  }
}

export function groupCaption(keys: string[], groups: number, before: number): string {
  return keys.length ? captions.group(keys, groups, before) : captions.aggregateNoGroup(before);
}

// GROUP BY и агрегаты: строки сворачиваются в группы с ключами g:N. Без GROUP BY одна группа, даже пустая
export const groupStep: SelectStep = {
  name: 'group',
  applies: (ctx) => Boolean(ctx.sel.groupClause) || aggregateExprs(ctx.sel).length > 0,
  async run(ctx) {
    const parts = groupParts(ctx);
    const { keys, keyColumns, aggregates, aggregateColumns, nullSkipColumns } = parts;
    const n = keys.length + aggregates.length;
    const ctids = ctx.aliasOrder.map((a) => `${ident(a)}.ctid`).join(', ');
    const order = keys.length ? ` ORDER BY ${keys.map((_, i) => i + 1).join(', ')}` : '';
    const r = await ctx.prober.rows(
      `SELECT ${parts.select}, ROW(${keys.join(', ')})::text, array_agg(${ctx.sql.rowKey} ORDER BY ${ctids})${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}${order}`,
    );
    await setGroupColumns(
      ctx,
      parts,
      r.fields.slice(0, n),
      r.rows.map((row) => row[n] as string),
    );
    const groups = r.rows.map((row, i) => ({
      key: groupKey(i),
      members: (row[n + 1] as RowKey[] | null) ?? [],
    }));
    const before = ctx.rows.length;
    ctx.rows = r.rows.map((row, i) => ({ key: groupKey(i), lineage: {}, values: row.slice(0, n) }));
    const running =
      keys.length || !before ? undefined : await runningValues(ctx, aggregates, ctids, ctx.rows[0].values);
    ctx.stages.push({
      id: stageId(ctx, 'group'),
      kind: 'group',
      keys,
      keyColumns,
      groups,
      aggregates,
      aggregateColumns,
      nullSkipColumns,
      ...(running ? { running } : {}),
      sourceRange: rangeOf(ctx.stmt, keys.length ? 'group' : 'select'),
      caption: groupCaption(keys, groups.length, before),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
