import { introspect } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import { initParser, parseSql } from '@/features/sql/parser';
import { traceStatement } from '@/features/tracer/trace';
import type { Stage, Trace, TraceOptions } from '@/features/tracer/types';

// Трасса первого оператора текста. Вызывать внутри inPreview
export async function traceSql(db: DbClient, sql: string, opts: Partial<TraceOptions> = {}): Promise<Trace> {
  await initParser();
  const parsed = parseSql(sql);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return traceStatement(parsed.statements[0], db, { ...opts, schema: opts.schema ?? (await introspect(db)) });
}

// Сводка трассы: 'scan:11 > filter:7 > project:7'
export function summary(trace: Trace): string {
  return trace.stages.map((s) => `${s.kind}:${s.rowCount ?? s.output.rows.length}`).join(' > ');
}

// Стадия нужного вида с сужением типа
export function stageOf<K extends Stage['kind']>(trace: Trace, kind: K): Extract<Stage, { kind: K }> {
  const stage = trace.stages.find((s) => s.kind === kind);
  if (!stage) throw new Error(`нет стадии ${kind}`);
  return stage as Extract<Stage, { kind: K }>;
}

// Значения строк стадии по колонке
export function column(stage: Stage, name: string): unknown[] {
  const i = stage.output.columns.findIndex((c) => c.name === name);
  return stage.output.rows.map((r) => r.values[i]);
}
