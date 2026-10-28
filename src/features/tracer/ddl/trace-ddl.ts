import { introspect } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from '../captions';
import { keyOf, resolveTarget, tryRun } from '../dml/shared';
import { ident, type Prober, sqlOf } from '../probe';
import type { Special } from '../route';
import type { Stage, TraceOptions } from '../types';
import { diffSchemas, type Renames } from './diff';

function renamesOf(stmt: ParsedStatement, schema: TraceOptions['schema']): Renames {
  const body = (
    stmt.ast as unknown as {
      RenameStmt?: {
        relation?: { relname?: string; schemaname?: string };
        subname?: string;
        newname?: string;
      };
    }
  ).RenameStmt;
  if (!body?.relation?.relname || !body.subname || !body.newname) return { columns: [], tables: [] };
  const table = schema.tables.find(
    (item) => item.name === body.relation?.relname && item.schema === (body.relation.schemaname ?? 'public'),
  );
  return table
    ? { columns: [{ tableId: table.id, from: body.subname, to: body.newname }], tables: [] }
    : { columns: [], tables: [] };
}

async function checkViolations(stmt: ParsedStatement, prober: Prober, opts: TraceOptions): Promise<string[]> {
  const body = (
    stmt.ast as unknown as {
      AlterTableStmt?: {
        relation?: { relname: string; schemaname?: string };
        cmds?: Array<{ AlterTableCmd?: { def?: { Constraint?: { contype?: string; raw_expr?: unknown } } } }>;
      };
    }
  ).AlterTableStmt;
  const expression = body?.cmds?.[0]?.AlterTableCmd?.def?.Constraint;
  if (expression?.contype !== 'CONSTR_CHECK' || !expression.raw_expr || !body?.relation) return [];
  const target = resolveTarget(opts.schema, body.relation);
  if (!target) return [];
  const alias = ident(target.alias);
  const run = await tryRun(
    prober,
    `SELECT ${alias}.ctid::text FROM ${target.sql} AS ${alias} WHERE NOT (${sqlOf(expression.raw_expr as never)})`,
  );
  return run.ok ? run.value.rows.map(([ctid]) => keyOf(target.alias, ctid as string)) : [];
}

export async function traceDdl(
  stmt: ParsedStatement,
  db: DbClient,
  prober: Prober,
  opts: TraceOptions,
): Promise<Special> {
  const conflictKeys = await checkViolations(stmt, prober, opts);
  const run = await tryRun(prober, stmt.text);
  if (!run.ok) {
    const stage: Stage = {
      id: '0:error',
      kind: 'error',
      error: run.error,
      focus: { tableIds: [], columns: [] },
      caption: captions.error(run.error.code, run.error.message),
      output: { columns: [], rows: [] },
      ...(conflictKeys.length ? { conflictKeys } : {}),
    };
    return {
      mode: 'final-only',
      fallbackReason: 'Запрос завершился ошибкой',
      stages: [stage],
      result: null,
      error: run.error,
    };
  }
  const diff = diffSchemas(opts.schema, await introspect(db), renamesOf(stmt, opts.schema));
  return {
    mode: 'full',
    stages: [
      {
        id: '0:ddl',
        kind: 'ddl',
        diff,
        caption: captions.ddl(),
        output: { columns: [], rows: [] },
        sourceRange: { from: stmt.from, to: stmt.to },
      },
    ],
    result: run.value,
    error: null,
  };
}
