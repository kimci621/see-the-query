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
// Три обратные кавычки посреди строки SQL блок не закрывают. Тело может быть пустым: ленивое `??`
// сначала пробует закрыть забор сразу, иначе пустой блок съел бы следующий
const SQL_FENCE = /^ {0,3}```sql(?:[ \t]+([^\n]*))?\n(?:([\s\S]*?)\n)?? {0,3}```[ \t]*$/gm;

// Заборы, которые MDX отрисует как sql-блок, а SQL_FENCE не извлечёт: ~~~sql, 4+ кавычек, отступ от 4 пробелов или таб
const FOREIGN_SQL_FENCE = /^(?:[ \t]*(?:`{4,}|~{3,})|(?: {4,}|\t)[ \t]*`{3})[ \t]*sql\b/gm;

export function checkForeignSqlFences(mdx: string): string[] {
  return [...mdx.matchAll(FOREIGN_SQL_FENCE)].map(
    (m) =>
      `строка ${mdx.slice(0, m.index).split('\n').length}: забор sql-блока в виде, который раннер не проверяет; нужен ровно \`\`\`sql без отступа`,
  );
}

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
  // Разбор нужен каждому исполняемому блоку: команды транзакций и правило «один оператор»
  if (blocks.some((b) => !b.meta.noexec)) await initParser();

  for (const { line, meta, sql } of blocks) {
    const at = `строка ${line}`;
    if (meta.noexec) continue;
    if (meta.expectRows === undefined && meta.expectError === undefined) {
      problems.push(`${at}: у блока нет ожидания (expect=rows:N или expectError=SQLSTATE)`);
      continue;
    }

    const parsed = parseSql(sql);
    // Превью урока команды транзакций не выполняет, а здесь COMMIT закрыл бы транзакцию превью,
    // и данные блока протекли бы в следующие
    if (!meta.apply && parsed.ok && parsed.statements.some((s) => s.kind === 'tcl')) {
      problems.push(
        `${at}: команда транзакции в блоке без apply: превью её не выполняет, а раннер закоммитил бы данные`,
      );
      continue;
    }
    // Кнопка урока применяет один оператор под курсором: блок из нескольких разошёлся бы с раннером
    if (meta.apply && parsed.ok && parsed.statements.length !== 1) {
      problems.push(`${at}: в apply-блоке должен быть один оператор, а их ${parsed.statements.length}`);
      continue;
    }

    // Трасса до выполнения: apply-блок ещё не закоммичен, данные те же, что увидит пользователь
    if (meta.run) {
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

const TERM = /<([TC])(?=[\s/>])([^>]*)>/g;
const TERM_ID = /^\s+id="([^"]+)"\s*\/?$/;

// <T id> и <C id> в тексте урока (mdx без кода): id есть в датасете. id выражением ({"x"}, {`x`})
// или без id регэксп не сверил бы, поэтому такой тег сам по себе проблема
export function checkTermIds(mdx: string, known: Set<string>): string[] {
  const problems: string[] = [];
  for (const [tag, name, attrs] of mdx.matchAll(TERM)) {
    const id = TERM_ID.exec(attrs ?? '')?.[1];
    if (id === undefined)
      problems.push(`${tag}: id пишем строкой в двойных кавычках, иначе раннер его не проверит`);
    else if (!known.has(id)) problems.push(`<${name} id="${id}">: такого объекта нет в датасете`);
  }
  return problems;
}
