import type { FuncCall, SelectStmt } from '@pgsql/types';
import { captions } from '../captions';
import { ident, sqlOf, TraceFallback } from '../probe';
import { groupKey } from '../rowkey';
import type { RowKey } from '../types';
import { AGGREGATES, funcName, walk } from '../whitelist';
import { rangeOf, type SelectCtx, stageId } from './context';
import type { SelectStep } from './pipeline';

// Уникальные агрегатные выражения из SELECT и HAVING в порядке появления
export function aggregateExprs(sel: SelectStmt): string[] {
  const out: string[] = [];
  walk([sel.targetList, sel.havingClause], (key, value) => {
    if (key !== 'FuncCall') return;
    const fc = value as FuncCall;
    if (fc.over || !(fc.agg_star || AGGREGATES.has(funcName(fc)))) return;
    const text = sqlOf({ FuncCall: fc });
    if (!out.includes(text)) out.push(text);
  });
  return out;
}

// Ключи GROUP BY выражениями и ' GROUP BY …' для всех проб над группами
export function groupParts(ctx: SelectCtx) {
  const targets = (ctx.sel.targetList ?? []).map((n) => ('ResTarget' in n ? n.ResTarget : {}));
  const keys = (ctx.sel.groupClause ?? []).map((node) => {
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
    return sqlOf(target?.val ?? node);
  });
  const aggregates = aggregateExprs(ctx.sel);
  ctx.sql.group = keys.length ? ` GROUP BY ${keys.join(', ')}` : '';
  return { keys, aggregates, select: [...keys, ...aggregates].join(', ') };
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

export function groupCaption(keys: string[], groups: number, before: number): string {
  return keys.length ? captions.group(keys, groups, before) : captions.aggregateNoGroup(before);
}

// GROUP BY и агрегаты: строки сворачиваются в группы с ключами g:N. Без GROUP BY одна группа, даже пустая
export const groupStep: SelectStep = {
  name: 'group',
  applies: (ctx) => Boolean(ctx.sel.groupClause) || aggregateExprs(ctx.sel).length > 0,
  async run(ctx) {
    const parts = groupParts(ctx);
    const { keys, aggregates } = parts;
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
    ctx.stages.push({
      id: stageId(ctx, 'group'),
      kind: 'group',
      keys,
      groups,
      aggregates,
      sourceRange: rangeOf(ctx.stmt, keys.length ? 'group' : 'select'),
      caption: groupCaption(keys, groups.length, before),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
