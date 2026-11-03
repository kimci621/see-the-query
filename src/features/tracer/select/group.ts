import type { FuncCall, GroupingSet, Node, SelectStmt } from '@pgsql/types';
import { DbException } from '@/features/db/types';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import { groupKey } from '../rowkey';
import type { RowKey } from '../types';
import { AGGREGATES, funcName } from '../whitelist';
import { rangeOf, refColumns, type SelectCtx, stageId } from './context';
import type { SelectStep } from './pipeline';

// Обход без спуска в подзапросы: агрегат внутри скалярного подзапроса не сворачивает внешний SELECT
function walkTop(node: unknown, fn: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkTop(item, fn);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    fn(key, value);
    if (key !== 'SubLink') walkTop(value, fn);
  }
}

// Уникальные агрегатные вызовы из SELECT и HAVING в порядке появления
function aggregateCalls(sel: SelectStmt): FuncCall[] {
  const out = new Map<string, FuncCall>();
  walkTop([sel.targetList, sel.havingClause], (key, value) => {
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

// Наборы группировки из ROLLUP / CUBE / GROUPING SETS в порядке SQL.
// Плоское выражение вне GroupingSet - отдельный набор из одного ключа
function groupingSetsOf(gs: GroupingSet): string[][] | null {
  const content = gs.content ?? [];
  if (gs.kind === 'GROUPING_SET_EMPTY') return [[]];
  if (gs.kind === 'GROUPING_SET_SIMPLE') return [content.map(sqlOf)];
  if (gs.kind === 'GROUPING_SET_ROLLUP') {
    const exprs = content.map(sqlOf);
    return Array.from({ length: exprs.length + 1 }, (_, i) => exprs.slice(0, exprs.length - i));
  }
  if (gs.kind === 'GROUPING_SET_CUBE') {
    const exprs = content.map(sqlOf);
    const n = exprs.length;
    return Array.from({ length: 1 << n }, (_, mask) => exprs.filter((_, i) => mask & (1 << (n - 1 - i))));
  }
  if (gs.kind === 'GROUPING_SET_SETS') {
    const sets: string[][] = [];
    for (const item of content) {
      if ('GroupingSet' in item) {
        const nested = groupingSetsOf(item.GroupingSet);
        if (!nested) return null;
        sets.push(...nested);
      } else if ('RowExpr' in item) {
        sets.push((item.RowExpr.args ?? []).map(sqlOf));
      } else {
        sets.push([sqlOf(item)]);
      }
    }
    return sets;
  }
  return null;
}

// Наборы группировки всего GROUP BY: простые пункты дают декартово произведение с наборами
function groupingInfo(nodes: Node[]): { sets: string[][]; label: string } | null {
  let combos: string[][] = [[]];
  for (const node of nodes) {
    let part: string[][] | null;
    if ('GroupingSet' in node) part = groupingSetsOf(node.GroupingSet);
    else part = [[sqlOf(node)]];
    if (!part) return null;
    combos = combos.flatMap((prefix) => part.map((set) => [...prefix, ...set]));
  }
  return { sets: combos, label: nodes.map(sqlOf).join(', ') };
}

// Ключи GROUP BY выражениями и ' GROUP BY …' для всех проб над группами
export function groupParts(ctx: SelectCtx) {
  const targets = (ctx.sel.targetList ?? []).map((n) => ('ResTarget' in n ? n.ResTarget : {}));
  const nodes = (ctx.sel.groupClause ?? []).map((node): Node => {
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
  const grouping = nodes.some((node) => 'GroupingSet' in node) ? groupingInfo(nodes) : null;
  // Для GROUPING SETS ключи - объединение всех наборов; повтор не дублируем
  const keys = grouping ? [...new Set(grouping.sets.flat())] : nodes.map(sqlOf);
  const calls = aggregateCalls(ctx.sel);
  const aggregates = calls.map((fc) => sqlOf({ FuncCall: fc }));
  ctx.sql.group = nodes.length ? ` GROUP BY ${nodes.map(sqlOf).join(', ')}` : '';
  // Колонки входа под ключами и в агрегатах считаются до setGroupColumns: потом ctx.columns это колонки групп
  const keyColumns = refColumns(ctx, grouping ? keys : nodes, ctx.columns);
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
  const filters = calls.flatMap((fc) =>
    fc.agg_filter ? [{ aggregate: sqlOf({ FuncCall: fc }), filter: fc.agg_filter }] : [],
  );
  return {
    keys,
    keyColumns,
    aggregates,
    aggregateColumns,
    nullSkipColumns,
    groupingSets: grouping?.sets,
    groupingLabel: grouping?.label ?? null,
    filters,
    select: [...keys, ...named].join(', '),
  };
}

// Колонки группы и ключ строки над группами: номер группы ищется по тексту ROW(ключи)
export async function setGroupColumns(
  ctx: SelectCtx,
  parts: { keys: string[]; aggregates: string[]; groupingSets?: string[][] },
  fields: Array<{ name: string; dataTypeID: number }>,
  rowTexts: string[],
  groupingValues?: number[],
): Promise<void> {
  const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
  ctx.columns = fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown' }));
  ctx.grouped = { ...parts, columns: ctx.columns.map((c) => c.name) };
  // Групповые уровни ROLLUP различаются битовой маской GROUPING: NULL ключа и NULL после свёртки - разные строки
  const grouping = parts.groupingSets && groupingValues && rowTexts.length ? groupingValues : null;
  const list = (grouping ? rowTexts.map((t, i) => `${t}:${grouping[i]}`) : rowTexts).map(
    (t) => `'${t.replaceAll("'", "''")}'`,
  );
  if (!parts.keys.length) {
    ctx.sql.rowKey = `'g:0'`;
    return;
  }
  ctx.sql.rowKey =
    grouping && parts.groupingSets
      ? `concat('g:', array_position(ARRAY[${list.join(', ')}]::text[], concat(ROW(${parts.keys.join(', ')})::text, ':', GROUPING(${parts.keys.join(', ')})::text)) - 1)`
      : `concat('g:', array_position(ARRAY[${list.join(', ')}]::text[], ROW(${parts.keys.join(', ')})::text) - 1)`;
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

export function groupCaption(
  keys: string[],
  groups: number,
  before: number,
  groupingLabel?: string | null,
): string {
  if (groupingLabel) return captions.groupBy(groupingLabel, groups, before);
  return keys.length ? captions.group(keys, groups, before) : captions.aggregateNoGroup(before);
}

// GROUP BY и агрегаты: строки сворачиваются в группы с ключами g:N. Без GROUP BY одна группа, даже пустая
export const groupStep: SelectStep = {
  name: 'group',
  applies: (ctx) => Boolean(ctx.sel.groupClause) || aggregateExprs(ctx.sel).length > 0,
  async run(ctx) {
    const parts = groupParts(ctx);
    const { keys, keyColumns, aggregates, aggregateColumns, nullSkipColumns, groupingSets } = parts;
    const n = keys.length + aggregates.length;
    const ctids = ctx.aliasOrder.map((a) => `${ident(a)}.ctid`).join(', ');
    const groupingSql = groupingSets ? `, GROUPING(${keys.join(', ')})::int` : '';
    const order = groupingSets
      ? ` ORDER BY GROUPING(${keys.join(', ')}), ${keys.map((_, i) => i + 1).join(', ')}`
      : keys.length
        ? ` ORDER BY ${keys.map((_, i) => i + 1).join(', ')}`
        : '';
    const r = await ctx.prober.rows(
      `SELECT ${parts.select}, ROW(${keys.join(', ')})::text${groupingSql}, array_agg(${ctx.sql.rowKey} ORDER BY ${ctids})${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}${order}`,
    );
    const membersAt = n + 1 + (groupingSets ? 1 : 0);
    const groupingValues = groupingSets ? r.rows.map((row) => Number(row[n + 1])) : undefined;
    // FILTER (WHERE ...) считается по входным строкам до свёртки: вердикты нужны сцене
    const inputKey = ctx.sql.rowKey;
    const filters: Array<{ aggregate: string; verdicts: Record<RowKey, boolean | null> }> = [];
    for (const f of parts.filters) {
      try {
        const fv = await ctx.prober.rows(
          `SELECT ${inputKey} AS __vs_k, (${sqlOf(f.filter)}) AS __vs_v${ctx.sql.from}${ctx.sql.where}`,
        );
        const verdicts: Record<RowKey, boolean | null> = {};
        for (const [key, verdict] of fv.rows) verdicts[key as RowKey] = verdict as boolean | null;
        filters.push({ aggregate: f.aggregate, verdicts });
      } catch (e) {
        if (!(e instanceof DbException)) throw e;
      }
    }
    await setGroupColumns(
      ctx,
      parts,
      r.fields.slice(0, n),
      r.rows.map((row) => row[n] as string),
      groupingValues,
    );
    const groups = r.rows.map((row, i) => ({
      key: groupKey(i),
      members: (row[membersAt] as RowKey[] | null) ?? [],
    }));
    const before = ctx.rows.length;
    ctx.rows = r.rows.map((row, i) => ({ key: groupKey(i), lineage: {}, values: row.slice(0, n) }));
    const running =
      keys.length || !before ? undefined : await runningValues(ctx, aggregates, ctids, ctx.rows[0].values);
    const groupingRows = groupingValues
      ? Object.fromEntries(groups.map((g, i) => [g.key, groupingValues[i]]))
      : undefined;
    ctx.stages.push({
      id: stageId(ctx, 'group'),
      kind: 'group',
      keys,
      keyColumns,
      groups,
      aggregates,
      aggregateColumns,
      nullSkipColumns,
      ...(groupingSets ? { groupingSets } : {}),
      ...(groupingRows ? { grouping: groupingRows } : {}),
      ...(filters.length ? { filters } : {}),
      ...(running ? { running } : {}),
      sourceRange: rangeOf(ctx.stmt, keys.length ? 'group' : 'select'),
      caption: groupCaption(keys, groups.length, before, parts.groupingLabel),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
