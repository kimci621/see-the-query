import { introspect, type SchemaSnapshot } from '@/features/db/introspect';
import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import { parseSqlMeta, type SqlMeta } from '@/features/lessons/mdx/sql-meta';
import { initParser, parseSql } from '@/features/sql/parser';
import { traceStatement } from '@/features/tracer/trace';
import { inPreview } from '../helpers/db';

export interface SqlBlockSource {
  line: number;
  rawMeta: string;
  meta: SqlMeta;
  sql: string;
}

// Забор ```sql с начала строки (до трёх пробелов отступа, как в CommonMark), закрывающий тоже с начала строки.
// Три обратные кавычки посреди строки SQL блок не закрывают
const SQL_FENCE = /^ {0,3}```sql(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n {0,3}```[ \t]*$/gm;

export function extractSqlBlocks(mdx: string): SqlBlockSource[] {
  return [...mdx.matchAll(SQL_FENCE)].map((m) => {
    const line = mdx.slice(0, m.index).split('\n').length;
    const rawMeta = (m[1] ?? '').trim();
    try {
      return { line, rawMeta, meta: parseSqlMeta(rawMeta), sql: m[2] ?? '' };
    } catch (e) {
      throw new Error(`строка ${line}: ${(e as Error).message}`);
    }
  });
}

const FINAL_ONLY_NOTE = /^\{\/\*\s*final-only:\s*\S.*\*\/\}$/;

// Блок с trace=final-only обязан иметь над собой MDX-комментарий с причиной (предыдущая непустая строка)
export function checkFinalOnlyNotes(mdx: string, blocks: SqlBlockSource[]): string[] {
  const lines = mdx.split('\n');
  const problems: string[] = [];
  for (const { line, meta } of blocks) {
    if (meta.trace !== 'final-only') continue;
    const prev = lines
      .slice(0, line - 1)
      .map((l) => l.trim())
      .findLast((l) => l !== '');
    if (!prev || !FINAL_ONLY_NOTE.test(prev)) {
      problems.push(
        `строка ${line}: над блоком trace=final-only нужен комментарий {/* final-only: причина */}`,
      );
    }
  }
  return problems;
}

type Outcome = { ok: true; results: QueryResult[] } | { ok: false; code: string; message: string };

async function run(db: DbClient, sql: string): Promise<Outcome> {
  try {
    return { ok: true, results: await db.exec(sql) };
  } catch (e) {
    if (e instanceof DbException) return { ok: false, code: e.db.code, message: e.db.message };
    throw e;
  }
}

// Число строк последнего оператора; у оператора без колонок результата (INSERT без RETURNING, DDL) это rowCount
function rowsOf(results: QueryResult[]): number {
  const last = results.at(-1);
  if (!last) return 0;
  return last.fields.length > 0 ? last.rows.length : (last.rowCount ?? 0);
}

// Выполняет блоки урока сверху вниз на одном клиенте. Возвращает проблемы, пустой список = всё сошлось
export async function checkBlocks(
  blocks: SqlBlockSource[],
  db: DbClient,
  opts: { trace: boolean } = { trace: true },
): Promise<string[]> {
  const problems: string[] = [];
  let schema: SchemaSnapshot | null = null;
  // Парсер нужен всем run-блокам: правило «один оператор» не зависит от трассы
  if (blocks.some((b) => b.meta.run && !b.meta.noexec)) await initParser();

  for (const { line, meta, sql } of blocks) {
    const at = `строка ${line}`;
    if (meta.noexec) continue;
    if (meta.expectRows === undefined && meta.expectError === undefined) {
      problems.push(`${at}: у блока нет ожидания (expect=rows:N или expectError=SQLSTATE)`);
      continue;
    }

    // Трасса до выполнения: apply-блок ещё не закоммичен, данные те же, что увидит пользователь
    if (meta.run) {
      const parsed = parseSql(sql);
      if (!parsed.ok) {
        // Синтаксическая ошибка может быть ожидаемой (expectError=42601): её проверит выполнение ниже
        if (meta.expectError === undefined)
          problems.push(`${at}: парсер не принял блок: ${parsed.error.message}`);
      } else if (parsed.statements.length !== 1) {
        problems.push(`${at}: в run-блоке должен быть один оператор, а их ${parsed.statements.length}`);
      } else if (opts.trace && meta.expectError === undefined && meta.trace !== 'final-only') {
        const [stmt] = parsed.statements;
        schema ??= await introspect(db);
        const snapshot = schema;
        try {
          const trace = stmt
            ? await inPreview(db, () => traceStatement(stmt, db, { schema: snapshot }))
            : null;
          if (trace && trace.mode !== 'full') {
            problems.push(
              `${at}: трасса final-only (${trace.fallbackReason ?? 'причина не указана'}); почини трассировщик или пометь блок trace=final-only с причиной`,
            );
          }
        } catch (e) {
          problems.push(`${at}: трассировщик упал: ${String(e)}`);
        }
      }
    }

    const outcome = meta.apply ? await run(db, sql) : await inPreview(db, () => run(db, sql));
    if (meta.apply && outcome.ok) schema = null;

    if (meta.expectError !== undefined) {
      if (outcome.ok) problems.push(`${at}: ожидалась ошибка ${meta.expectError}, а запрос выполнился`);
      else if (outcome.code !== meta.expectError) {
        problems.push(
          `${at}: ожидалась ошибка ${meta.expectError}, получена ${outcome.code}: ${outcome.message}`,
        );
      }
      continue;
    }
    if (!outcome.ok) {
      problems.push(`${at}: неожиданная ошибка ${outcome.code}: ${outcome.message}`);
      continue;
    }
    const rows = rowsOf(outcome.results);
    if (rows !== meta.expectRows)
      problems.push(`${at}: ожидалось ${meta.expectRows} строк, получено ${rows}`);
  }
  return problems;
}
