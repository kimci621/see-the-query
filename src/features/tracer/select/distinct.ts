import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import type { RowKey } from '../types';
import { rowCanon } from '../verify';
import { outputIndex, rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// DISTINCT и DISTINCT ON: стопки одинаковых строк, победитель первый по ORDER BY
export const distinctStep: SelectStep = {
  name: 'distinct',
  applies: (ctx) => Boolean(ctx.sel.distinctClause),
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const { sql } = ctx;
    const isOn = Object.keys((ctx.sel.distinctClause as Node[])[0]).length > 0;
    let groupsSql: string;
    let on: string[] | null = null;
    if (!isOn) {
      // Группы по всем выходным колонкам; GROUP BY сводит NULL вместе, как DISTINCT
      const cols = out.columns.map((_, i) => `c${i}`).join(', ');
      groupsSql = `SELECT array_agg(__vs_s.__vs_key) FROM (SELECT ${sql.targets}, ${sql.rowKey}${sql.from}${sql.where}${sql.group}) AS __vs_s(${cols}, __vs_key) GROUP BY ${cols}`;
    } else {
      const nodes = ctx.sel.distinctClause as Node[];
      on = nodes.map(sqlOf);
      const exprs = nodes.map((node) => {
        const i = outputIndex(node, out);
        if (i === null) return sqlOf(node);
        const k = out.kinds[i];
        return k.expr ? sqlOf(k.expr) : `${ident(k.alias ?? '')}.${ident(k.column ?? '')}`;
      });
      // Подзапрос: над группами ключ строки сам содержит выражения GROUP BY
      const cols = exprs.map((_, i) => `d${i}`).join(', ');
      groupsSql = `SELECT array_agg(__vs_s.__vs_key) FROM (SELECT ${exprs.join(', ')}, ${sql.rowKey}${sql.from}${sql.where}${sql.group}) AS __vs_s(${cols}, __vs_key) GROUP BY ${cols}`;
    }
    const r = await ctx.prober.rows(groupsSql);
    const pos = new Map(ordered.order.map((k, i) => [k, i]));
    const inReference = new Set(ctx.reference.rows.map(rowCanon));
    const canonOf = (k: RowKey) => rowCanon(ordered.values.get(k) ?? []);
    const stacks = r.rows.map(([keys]) => {
      const members = (keys as RowKey[]).slice().sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
      // Среди равных по ORDER BY Postgres мог выбрать любую строку: берём ту, что есть в эталоне
      const tie = ordered.tuple.get(members[0]);
      const winner =
        members.find((m) => ordered.tuple.get(m) === tie && inReference.has(canonOf(m))) ?? members[0];
      if (winner !== members[0]) {
        const [wi, fi] = [ordered.order.indexOf(winner), ordered.order.indexOf(members[0])];
        [ordered.order[wi], ordered.order[fi]] = [ordered.order[fi], ordered.order[wi]];
      }
      return { winner, members: [winner, ...members.filter((m) => m !== winner)] };
    });
    const winners = new Set(stacks.map((s) => s.winner));
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => winners.has(row.key));
    ctx.stages.push({
      id: stageId(ctx, 'distinct'),
      kind: 'distinct',
      on,
      stacks,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: on
        ? captions.distinctOn(on, before, ctx.rows.length)
        : captions.distinct(before, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
