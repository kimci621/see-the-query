import type { Node, RangeSubselect, SelectStmt } from '@pgsql/types';
import type { QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import type { Locale } from '@/lib/i18n';
import { captionsForLocale } from '../captions';
import { type Prober, sqlOf, typeNames } from '../probe';
import { resultKey } from '../rowkey';
import { rangeOf } from '../select/context';
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
function lateralItem(sel: SelectStmt, locale: Locale = 'ru'): LateralItem | { reason: string } {
  const text = (ru: string, en: string) => (locale === 'en' ? en : ru);
  const items = sel.fromClause ?? [];
  const found = items.flatMap((node, i) =>
    'RangeSubselect' in node && node.RangeSubselect.lateral ? [i] : [],
  );
  if (!found.length) return { reason: text('LATERAL не найден', 'LATERAL not found') };
  if (found.length > 1)
    return {
      reason: text(
        'Несколько LATERAL в одном FROM пока не анимируются',
        'Multiple LATERAL items in one FROM are not animated yet',
      ),
    };
  if (found[0] === 0)
    return {
      reason: text(
        'LATERAL без источника слева не анимируется',
        'LATERAL without a left source is not animated',
      ),
    };
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
    if (lateral)
      return {
        reason: text(
          'JOIN LATERAL с условием ON пока не анимируется',
          'JOIN LATERAL with an ON condition is not animated yet',
        ),
      };
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
  const text = (ru: string, en: string) => (opts.locale === 'en' ? en : ru);
  const found = lateralItem(sel, opts.locale);
  if ('reason' in found) return found;
  const body = found.subselect.subquery;
  if (!body || !('SelectStmt' in body))
    return {
      reason: text('LATERAL без SELECT пока не анимируется', 'LATERAL without SELECT is not animated yet'),
    };

  // Внешняя часть без LATERAL: её стадии нужны сцене слева
  const star: Node = { ResTarget: { val: { ColumnRef: { fields: [{ A_Star: {} }] } } } };
  const outerSel: SelectStmt = { targetList: [star], fromClause: found.others };
  const outer = await trace(childStatement(stmt, outerSel), { ...opts, schema: opts.schema });
  if (outer.mode !== 'full')
    return {
      reason: text(
        `Внешняя часть LATERAL не анимируется: ${outer.fallbackReason ?? 'причина не указана'}`,
        `The outer part of LATERAL is not animated: ${outer.fallbackReason ?? 'no reason provided'}`,
      ),
    };
  const outerRelation = outer.stages.at(-1)?.output ?? { columns: [], rows: [] };
  if (!outerRelation.rows.length)
    return {
      reason: text(
        'LATERAL без внешних строк пока не анимируется',
        'LATERAL without outer rows is not animated yet',
      ),
    };

  const names = innerNames(opts.schema, body.SelectStmt);
  const samples: Array<{ outer: string; inner: Trace }> = [];
  for (const row of outerRelation.rows.slice(0, 3)) {
    const { ast } = substituteOuter(body.SelectStmt, outerValues(outerRelation.columns, row.values), names);
    const inner = await trace(childStatement(stmt, ast as SelectStmt), { ...opts, schema: opts.schema });
    if (inner.mode !== 'full')
      return {
        reason: text(
          `LATERAL не анимируется: ${inner.fallbackReason ?? 'причина не указана'}`,
          `LATERAL is not animated: ${inner.fallbackReason ?? 'no reason provided'}`,
        ),
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
    caption: captionsForLocale(opts.locale).subqueryLateral(
      samples.length,
      outerRelation.rows.length,
      output.rows.length,
    ),
    output,
  };
  const stages: Stage[] = [...outer.stages, stage];
  // ORDER BY снаружи LATERAL применяется к готовому итогу: показываем отдельной стадией
  if (sel.sortClause) {
    stages.push({
      id: `${stages.length}:sort`,
      kind: 'sort',
      order: output.rows.map((row) => row.key),
      sortKeys: sel.sortClause.map(sqlOf),
      keyColumns: [],
      sourceRange: rangeOf(stmt, 'order'),
      caption: captionsForLocale(opts.locale).sort(sel.sortClause.map(sqlOf), output.rows.length),
      output,
    });
  }
  return { stages: [...stages], output };
}
