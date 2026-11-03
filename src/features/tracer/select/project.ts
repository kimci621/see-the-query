import type { CaseExpr, CaseWhen } from '@pgsql/types';
import { DbException } from '@/features/db/types';
import { captions } from '../captions';
import { sqlOf } from '../probe';
import type { Column, RowKey } from '../types';
import { hasVolatile } from '../whitelist';
import { type Output, rangeOf, type SelectCtx, stageId } from './context';
import type { SelectStep } from './pipeline';

// Имя входной колонки в removed/renamed: у одноимённых колонок разных источников с алиасом, 'p.name'.
// Оверлей считает так же (overlay/frame.ts, columnIds)
export function columnIds(columns: Array<Pick<Column, 'name' | 'source'>>): string[] {
  return columns.map((c) =>
    c.source && columns.filter((d) => d.name === c.name).length > 1 ? `${c.source.alias}.${c.name}` : c.name,
  );
}

// Сводка проекции: kept / removed / computed / renamed относительно входных колонок
export function projection(out: Output, input: Column[]) {
  const ids = columnIds(input);
  const kept: string[] = [];
  const computed: string[] = [];
  const renamed: Record<string, string> = {};
  const used = new Set<number>();
  out.kinds.forEach((k, i) => {
    const name = out.columns[i].name;
    if (k.kind === 'computed') computed.push(name);
    if (!k.column) return;
    // Своя колонка по источнику, иначе по имени (слитая USING, группа); свободная раньше уже взятой
    const bySource = (c: Column) => c.source?.alias === k.alias && c.source?.column === k.column;
    const byName = (c: Column) => c.name === k.column;
    const tries = [bySource, byName].flatMap((f) => [(c: Column, j: number) => !used.has(j) && f(c), f]);
    const at = tries.map((f) => input.findIndex(f)).find((j) => j >= 0) ?? -1;
    if (at < 0) return;
    used.add(at);
    if (k.kind === 'renamed') renamed[ids[at]] = name;
    else kept.push(name);
  });
  return { kept, removed: ids.filter((_, j) => !used.has(j)), computed, renamed };
}

// CASE WHEN в SELECT: ветки подписываем, номер сработавшей ветки считает Postgres.
// Ветки нужны только для сцены; без пробы стадия живёт как обычная проекция
async function caseBranches(ctx: SelectCtx, out: Output) {
  const targets = ctx.sel.targetList ?? [];
  if (out.kinds.length !== targets.length) return undefined;
  const found: Array<{ column: string; labels: string[]; fired: Record<RowKey, number> }> = [];
  for (const [i, node] of targets.entries()) {
    const rt = 'ResTarget' in node ? node.ResTarget : null;
    const val = rt?.val;
    if (!val || !('CaseExpr' in val)) continue;
    const ce: CaseExpr = val.CaseExpr;
    if (hasVolatile(ce)) continue;
    const whens = (ce.args ?? []).flatMap((arg) => ('CaseWhen' in arg ? [arg.CaseWhen] : []));
    const labels = whens.map(
      (w: CaseWhen) => `WHEN ${w.expr ? sqlOf(w.expr) : '?'} THEN ${w.result ? sqlOf(w.result) : 'NULL'}`,
    );
    labels.push(`ELSE ${ce.defresult ? sqlOf(ce.defresult) : 'NULL'}`);
    const branchSql = `CASE ${whens
      .map((w, j) => `WHEN ${w.expr ? sqlOf(w.expr) : 'FALSE'} THEN ${j}`)
      .join(' ')} ELSE ${whens.length} END`;
    try {
      const r = await ctx.prober.rows(
        `SELECT ${ctx.sql.rowKey} AS __vs_k, ${branchSql} AS __vs_b${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}`,
      );
      const fired: Record<RowKey, number> = {};
      for (const [key, branch] of r.rows) fired[key as RowKey] = Number(branch);
      if (ctx.rows.some((row) => fired[row.key] === undefined)) continue;
      found.push({ column: out.columns[i].name, labels, fired });
    } catch (e) {
      if (!(e instanceof DbException)) throw e;
    }
  }
  return found.length ? found : undefined;
}

// SELECT: какие колонки остались, какие вычислены и переименованы
export const projectStep: SelectStep = {
  name: 'project',
  applies: () => true,
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const input = ctx.columns;
    const p = projection(out, input);
    const branches = await caseBranches(ctx, out);
    ctx.columns = out.columns;
    ctx.rows = ctx.rows.map((row) => ({ ...row, values: ordered.values.get(row.key) ?? [] }));
    ctx.stages.push({
      id: stageId(ctx, 'project'),
      kind: 'project',
      ...p,
      ...(branches ? { branches } : {}),
      volatile: ctx.volatile || undefined,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: captions.project(out.columns.length - p.computed.length, input.length, p.computed.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
