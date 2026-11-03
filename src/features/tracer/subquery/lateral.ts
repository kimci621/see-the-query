import type { Node, RangeSubselect, SelectStmt } from '@pgsql/types';
import type { QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { type Prober, sqlOf, typeNames } from '../probe';
import { resultKey } from '../rowkey';
import type { Relation, Row, Stage, Trace, TraceOptions } from '../types';
import { innerNames, outerValues, substituteOuter } from './substitute';

export type TraceChild = (stmt: ParsedStatement, opts?: Partial<TraceOptions>) => Promise<Trace>;

// LATERAL в любом месте FROM: верхний уровень после запятой или справа от JOIN
export function hasLateral(sel: SelectStmt): boolean {
  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(walk);
    if (!node || typeof node !== 'object') return false;
    if ('RangeSubselect' in node)
      return Boolean((node as { RangeSubselect: RangeSubselect }).RangeSubselect.lateral);
    return Object.values(node).some(walk);
  };
  return (sel.fromClause ?? []).some(walk);
}

interface LateralItem {
  subselect: RangeSubselect;
  others: Node[];
}

// LATERAL после запятой в FROM: подзапрос видит строки предыдущих источников.
// JOIN LATERAL с ON пока не берём: условие ON живёт снаружи подзапроса
function lateralItem(sel: SelectStmt): LateralItem | { reason: string } {
  const items = sel.fromClause ?? [];
  const found = items.flatMap((node, i) =>
    'RangeSubselect' in node && node.RangeSubselect.lateral ? [i] : [],
  );
  if (!found.length) return { reason: 'LATERAL не найден' };
  if (found.length > 1) return { reason: 'Несколько LATERAL в одном FROM пока не анимируются' };
  if (found[0] === 0) return { reason: 'LATERAL без источника слева не анимируется' };
  for (const item of items) {
    let lateral = false;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (!node || typeof node !== 'object') return;
      if ('JoinExpr' in node) {
        const je = (node as { JoinExpr: { rarg?: Node; larg?: Node } }).JoinExpr;
        if (je.rarg && 'RangeSubselect' in je.rarg && je.rarg.RangeSubselect.lateral) lateral = true;
        walk(je.larg);
        walk(je.rarg);
      }
    };
    walk(item);
    if (lateral) return { reason: 'JOIN LATERAL с условием ON пока не анимируется' };
  }
  const index = found[0] ?? 0;
  return {
    subselect: (items[index] as { RangeSubselect: RangeSubselect }).RangeSubselect,
    others: items.filter((_, i) => i !== index),
  };
}

function childStatement(parent: ParsedStatement, sel: SelectStmt): ParsedStatement {
  return {
    index: parent.index,
    from: parent.from,
    to: parent.to,
    byteFrom: parent.byteFrom,
    text: sqlOf({ SelectStmt: sel }),
    ast: { SelectStmt: sel },
    kind: 'select',
  };
}

// LATERAL: внешние источники трассируются как обычно, затем для первых трёх строк
// выполняется подзапрос с подставленными значениями. Итог берётся из эталона Postgres
export async function traceLateral(
  stmt: ParsedStatement,
  sel: SelectStmt,
  reference: QueryResult,
  prober: Prober,
  opts: TraceOptions,
  trace: TraceChild,
): Promise<{ stages: Stage[]; output: Relation } | { reason: string }> {
  const found = lateralItem(sel);
  if ('reason' in found) return found;
  const body = found.subselect.subquery;
  if (!body || !('SelectStmt' in body)) return { reason: 'LATERAL без SELECT пока не анимируется' };

  // Внешняя часть без LATERAL: её стадии нужны сцене слева
  const star: Node = { ResTarget: { val: { ColumnRef: { fields: [{ A_Star: {} }] } } } };
  const outerSel: SelectStmt = { targetList: [star], fromClause: found.others };
  const outer = await trace(childStatement(stmt, outerSel), { ...opts, schema: opts.schema });
  if (outer.mode !== 'full')
    return {
      reason: `Внешняя часть LATERAL не анимируется: ${outer.fallbackReason ?? 'причина не указана'}`,
    };
  const outerRelation = outer.stages.at(-1)?.output ?? { columns: [], rows: [] };
  if (!outerRelation.rows.length) return { reason: 'LATERAL без внешних строк пока не анимируется' };

  const names = innerNames(opts.schema, body.SelectStmt);
  const samples: Array<{ outer: string; inner: Trace }> = [];
  for (const row of outerRelation.rows.slice(0, 3)) {
    const { ast } = substituteOuter(body.SelectStmt, outerValues(outerRelation.columns, row.values), names);
    const inner = await trace(childStatement(stmt, ast as SelectStmt), { ...opts, schema: opts.schema });
    if (inner.mode !== 'full')
      return {
        reason: `LATERAL не анимируется: ${inner.fallbackReason ?? 'причина не указана'}`,
      };
    samples.push({ outer: row.key, inner });
  }

  const typeMap = await typeNames(
    prober,
    reference.fields.map((f) => f.dataTypeID),
    new Map(),
  );
  const output: Relation = {
    columns: reference.fields.map((field) => ({
      name: field.name,
      type: typeMap.get(field.dataTypeID) ?? 'unknown',
    })),
    rows: reference.rows.map((values, i): Row => ({ key: resultKey(i), lineage: {}, values })),
  };
  const stage: Stage & { kind: 'subquery' } = {
    id: `${outer.stages.length}:subquery`,
    kind: 'subquery',
    mode: 'lateral',
    samples,
    limit3: outerRelation.rows.length > 3,
    caption: captions.subqueryLateral(samples.length, outerRelation.rows.length, output.rows.length),
    output,
  };
  return { stages: [...outer.stages, stage], output };
}
