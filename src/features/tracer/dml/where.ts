import type { SelectStmt } from '@pgsql/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { type Prober, TraceFallback } from '../probe';
import { createSelectCtx } from '../select/context';
import { filterStep } from '../select/filter';
import { flattenFrom, joinStep } from '../select/join';
import type { SelectStep } from '../select/pipeline';
import { scanStep } from '../select/scan';
import type { RowKey, Stage, TraceOptions } from '../types';
import { type DmlNode, keyOf, type Target } from './shared';

export async function whereStages(
  stmt: ParsedStatement,
  body: DmlNode,
  target: Target,
  prober: Prober,
  opts: TraceOptions,
  op: 'update' | 'delete',
): Promise<{ stages: Stage[]; hit: RowKey[] }> {
  const sel = {
    targetList: [{ ResTarget: { val: { ColumnRef: { fields: [{ A_Star: {} }] } } } }],
    fromClause: [{ RangeVar: body.relation }, ...(body.fromClause ?? body.usingClause ?? [])],
    ...(body.whereClause ? { whereClause: body.whereClause } : {}),
  } as SelectStmt;
  const from = flattenFrom(sel, opts.schema);
  if (!from.ok) throw new TraceFallback(from.reason);
  const ctx = createSelectCtx({
    stmt,
    sel,
    prober,
    reference: { fields: [], rows: [] },
    volatile: false,
    ...from,
    schema: opts.schema,
  });
  for (const step of [scanStep, joinStep, filterStep] satisfies SelectStep[])
    if (step.applies(ctx)) await step.run(ctx);

  const hit = [
    ...new Set(
      ctx.rows.flatMap((row) => {
        const ctid = row.lineage[target.alias];
        return ctid === null || ctid === undefined ? [] : [keyOf(target.alias, ctid)];
      }),
    ),
  ];
  const filter = ctx.stages.findLast((stage) => stage.kind === 'filter');
  if (filter?.kind === 'filter') {
    filter.target = true;
    filter.caption = captions.dmlWhere(op, hit.length, ctx.stages[0].output.rows.length);
  }
  return { stages: ctx.stages, hit };
}
