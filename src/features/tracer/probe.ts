import type { Node } from '@pgsql/types';
import { QuoteUtils } from 'pgsql-deparser';
import type { DbClient, QueryResult } from '@/features/db/types';
import { deparse } from '@/features/sql/deparse';
import { withSavepoint } from './savepoint';

// Проба вернула больше maxRows строк: трасса уходит в сжатый режим
export class ProbeOverflow extends Error {
  constructor() {
    super('probe overflow');
    this.name = 'ProbeOverflow';
  }
}

// Трасса не может быть честной: уходим в final-only с этой причиной
export class TraceFallback extends Error {}

export interface Prober {
  maxRows: number;
  run(sql: string): Promise<QueryResult>; // проба как есть (агрегаты, счётчики)
  rows(sql: string): Promise<QueryResult>; // проба со страховочным LIMIT maxRows + 1
}

// statement_timeout в PGlite не прерывает запросы, поэтому: signal между пробами и LIMIT на каждой строковой пробе
export function createProber(db: DbClient, opts: { signal?: AbortSignal; maxRows: number }): Prober {
  const run = async (sql: string) => {
    opts.signal?.throwIfAborted();
    return withSavepoint(db, () => db.query(sql));
  };
  return {
    maxRows: opts.maxRows,
    run,
    async rows(sql) {
      const result = await run(`SELECT * FROM (${sql}) AS __vs_p LIMIT ${opts.maxRows + 1}`);
      if (result.rows.length > opts.maxRows) throw new ProbeOverflow();
      return result;
    },
  };
}

// Фрагмент AST в одну строку SQL. Целый SelectStmt не депарсим: депарсер теряет WITH TIES
export function sqlOf(node: Node): string {
  return deparse(node).replace(/\s*\n\s*/g, ' ');
}

// Идентификатор в кавычках, если нужно: "B", "order"
export function ident(name: string): string {
  return QuoteUtils.quoteIdentifier(name);
}

// Имена типов по OID: 1184 → 'timestamp with time zone'. cache живёт одну трассу
export async function typeNames(
  prober: Prober,
  oids: number[],
  cache: Map<number, string>,
): Promise<Map<number, string>> {
  const missing = [...new Set(oids)].filter((o) => !cache.has(o));
  if (missing.length) {
    const r = await prober.run(
      `SELECT oid::int, format_type(oid, NULL) FROM pg_type WHERE oid IN (${missing.join(', ')})`,
    );
    for (const [oid, name] of r.rows) cache.set(oid as number, name as string);
  }
  return cache;
}
