import { captions } from '../captions';
import type { Column } from '../types';
import { type Output, rangeOf, stageId } from './context';
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

// SELECT: какие колонки остались, какие вычислены и переименованы
export const projectStep: SelectStep = {
  name: 'project',
  applies: () => true,
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const input = ctx.columns;
    const p = projection(out, input);
    ctx.columns = out.columns;
    ctx.rows = ctx.rows.map((row) => ({ ...row, values: ordered.values.get(row.key) ?? [] }));
    ctx.stages.push({
      id: stageId(ctx, 'project'),
      kind: 'project',
      ...p,
      volatile: ctx.volatile || undefined,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: captions.project(out.columns.length - p.computed.length, input.length, p.computed.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
