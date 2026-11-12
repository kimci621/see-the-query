import type { FuncCall } from '@pgsql/types';
import { type DbClient, DbException, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from '@/features/db/types';
import { parseSql } from '@/features/sql/parser';
import type { Stage } from './types';
import { AGGREGATES, funcName, walk } from './whitelist';

export interface PlanNode {
  nodeType: string;
  relation?: string;
  schema?: string;
  alias?: string;
  indexName?: string;
  filter?: string;
  indexCond?: string;
  planRows?: number;
  actualRows?: number;
  rowsRemoved?: number;
  rowsRechecked?: number;
  loops?: number;
  sharedHitBlocks?: number;
  sharedReadBlocks?: number;
  actualTotalTime?: number;
  totalCost?: number;
  children: PlanNode[];
}

function convert(raw: Record<string, unknown>): PlanNode {
  return {
    nodeType: String(raw['Node Type']),
    relation: raw['Relation Name'] as string | undefined,
    schema: raw.Schema as string | undefined,
    alias: raw.Alias as string | undefined,
    indexName: raw['Index Name'] as string | undefined,
    filter: raw.Filter as string | undefined,
    indexCond: raw['Index Cond'] as string | undefined,
    planRows: raw['Plan Rows'] as number | undefined,
    actualRows: raw['Actual Rows'] as number | undefined,
    rowsRemoved: raw['Rows Removed by Filter'] as number | undefined,
    rowsRechecked: raw['Rows Removed by Index Recheck'] as number | undefined,
    loops: raw['Actual Loops'] as number | undefined,
    sharedHitBlocks: raw['Shared Hit Blocks'] as number | undefined,
    sharedReadBlocks: raw['Shared Read Blocks'] as number | undefined,
    actualTotalTime: raw['Actual Total Time'] as number | undefined,
    totalCost: raw['Total Cost'] as number | undefined,
    children: ((raw.Plans as Record<string, unknown>[] | undefined) ?? []).map(convert),
  };
}

// Вызывающий открывает preview; точка сохранения изолирует ошибку EXPLAIN и read-only режим.
export async function explainPlan(db: DbClient, sql: string): Promise<PlanNode | null> {
  const parsed = parseSql(sql);
  if (!parsed.ok || parsed.statements.length !== 1 || parsed.statements[0]?.kind !== 'select') return null;
  const stmt = parsed.statements[0];
  let unsafe = false;
  walk(stmt.ast, (key, value) => {
    if (key === 'FuncCall') {
      const call = value as FuncCall;
      const names = call.funcname ?? [];
      const schema = names.length === 2 && 'String' in names[0] ? names[0].String.sval : undefined;
      if (
        !AGGREGATES.has(funcName(call)) ||
        names.length > 2 ||
        (names.length === 2 && schema !== 'pg_catalog')
      )
        unsafe = true;
    }
    if (key === 'lockingClause' || key === 'IntoClause') unsafe = true;
  });
  if (unsafe) return null;
  await db.query('savepoint __vs_explain');
  let crashed = false;
  try {
    await db.query('set local transaction_read_only = on');
    const result = await db.query(`explain (analyze, buffers, verbose, format json) ${stmt.text}`);
    const cell = result.rows[0]?.[0];
    const value: unknown = typeof cell === 'string' ? JSON.parse(cell) : cell;
    if (!Array.isArray(value) || !value[0]?.Plan) return null;
    return convert(value[0].Plan as Record<string, unknown>);
  } catch (error) {
    if (
      error instanceof DbException &&
      (error.db.code === SANDBOX_TIMEOUT || error.db.code === SANDBOX_CRASHED)
    ) {
      crashed = true;
      throw error;
    }
    if (!(error instanceof DbException)) throw error;
    return null;
  } finally {
    if (!crashed) {
      await db.query('rollback to savepoint __vs_explain');
      await db.query('release savepoint __vs_explain');
    }
  }
}

const SCANS = new Set(['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan']);

// PostgreSQL показывает среднее за один проход, поэтому общее число может быть приблизительным.
export function rowsRead(node: PlanNode): number | null {
  if (!SCANS.has(node.nodeType) || node.actualRows === undefined || node.loops === undefined) return null;
  return (node.actualRows + (node.rowsRemoved ?? 0) + (node.rowsRechecked ?? 0)) * node.loops;
}

export function linkPlanToStages(
  plan: PlanNode,
  stages: Stage[],
): Array<{ node: PlanNode; stageIndex: number | null }> {
  const links: Array<{ node: PlanNode; stageIndex: number | null }> = [];
  const visit = (node: PlanNode, bitmapHeap?: PlanNode): void => {
    let stageIndex = -1;
    const source = node.nodeType === 'Bitmap Index Scan' ? bitmapHeap : node;
    if ((SCANS.has(node.nodeType) || node.nodeType === 'Bitmap Index Scan') && source?.relation) {
      const matching = stages
        .map((stage, index) => ({ stage, index }))
        .filter(
          ({ stage }) =>
            stage.kind === 'scan' &&
            stage.tableId === `${source.schema ?? 'public'}.${source.relation}` &&
            (!source.alias || stage.alias === source.alias),
        );
      if (matching.length === 1) stageIndex = matching[0].index;
    } else {
      const kind =
        node.nodeType === 'Sort' || node.nodeType === 'Incremental Sort'
          ? 'sort'
          : node.nodeType === 'Limit'
            ? 'limit'
            : node.nodeType === 'Aggregate' || node.nodeType === 'Group'
              ? 'group'
              : ['Hash Join', 'Nested Loop', 'Merge Join'].includes(node.nodeType)
                ? 'join'
                : null;
      if (kind) {
        const matching = stages
          .map((stage, index) => ({ stage, index }))
          .filter(({ stage }) => stage.kind === kind);
        if (matching.length === 1) stageIndex = matching[0].index;
      }
    }
    links.push({ node, stageIndex: stageIndex < 0 ? null : stageIndex });
    const inherited = node.nodeType === 'Bitmap Heap Scan' ? node : bitmapHeap;
    for (const child of node.children) visit(child, inherited);
  };
  visit(plan);
  return links;
}
