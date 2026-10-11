import { captions } from '../captions';
import { type Output, rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// Сводка проекции: kept / removed / computed / renamed относительно колонок таблицы
export function projection(out: Output, scanColumns: string[]) {
  const kept: string[] = [];
  const computed: string[] = [];
  const renamed: Record<string, string> = {};
  const used = new Set<string>();
  out.kinds.forEach((k, i) => {
    const name = out.columns[i].name;
    if (k.kind === 'computed') computed.push(name);
    else if (k.column) {
      used.add(k.column);
      if (k.kind === 'renamed') renamed[k.column] = name;
      else kept.push(name);
    }
  });
  return { kept, removed: scanColumns.filter((c) => !used.has(c)), computed, renamed };
}

// SELECT: какие колонки остались, какие вычислены и переименованы
export const projectStep: SelectStep = {
  name: 'project',
  applies: () => true,
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const p = projection(out, ctx.scanColumns);
    ctx.columns = out.columns;
    ctx.rows = ctx.rows.map((row) => ({ ...row, values: ordered.values.get(row.key) ?? [] }));
    ctx.stages.push({
      id: stageId(ctx, 'project'),
      kind: 'project',
      ...p,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: captions.project(
        p.kept.length + Object.keys(p.renamed).length,
        ctx.scanColumns.length,
        p.computed.length,
      ),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
