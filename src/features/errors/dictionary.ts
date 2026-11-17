import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { type DbError, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from '@/features/db/types';
import { charToByte } from '@/features/sql/offsets';
import { isParserReady, parseSql } from '@/features/sql/parser';
import { relationsOf } from '@/features/sql/relations';
import type { Locale } from '@/lib/i18n';

export interface ErrorExplanation {
  title: string;
  body: string;
  suggestion?: string;
  fix?: { from: string; to: string }; // правка в один клик, только если нашлось ближайшее имя
  highlight: { tableIds: string[]; columns: string[] };
}
export interface ErrorContext {
  sql: string;
  schema: SchemaSnapshot | null;
  locale?: Locale;
}
type Entry = (err: DbError, ctx: ErrorContext) => ErrorExplanation;

const none = { tableIds: [], columns: [] };
const tr = (ctx: ErrorContext, ru: string, en: string) => (ctx.locale === 'en' ? en : ru);

// Первое имя в кавычках из текста ошибки: relation "books" → books
const quoted = (message: string) => /"([^"]+)"/.exec(message)?.[1] ?? '';

// Текст аргумента GROUPING по позиции Postgres: grouping(b.price) → b.price
function groupingArgumentText(sql: string, position: number | undefined): string | undefined {
  if (position == null) return undefined;
  const at = Array.from(sql)
    .slice(0, position - 1)
    .join('').length;
  const before = sql.slice(0, at + 1);
  const call = /(?:^|[^\w$])grouping\s*\(/gi;
  let match: RegExpExecArray | null = null;
  for (let m = call.exec(before); m; m = call.exec(before)) match = m;
  if (!match) return undefined;
  const open = match.index + match[0].lastIndexOf('(');
  if (open >= at) return undefined;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      const arg = sql.slice(open + 1, i).trim();
      return arg || undefined;
    }
  }
  return undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// Ближайшее по написанию имя: не дальше 2 правок и не больше половины длины
function closest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.min(2, Math.floor(name.length / 2)) + 1;
  for (const c of new Set(candidates)) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d > 0 && d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

// Таблицы, имя которых встречается в тексте запроса отдельным словом
function tablesInSql(ctx: ErrorContext): TableInfo[] {
  const words = new Set(ctx.sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []);
  return ctx.schema?.tables.filter((t) => words.has(t.name.toLowerCase())) ?? [];
}

// SELECT без FROM: `select title, pr` даёт 42703 на первую колонку, хотя не хватает FROM
function selectWithoutFrom(sql: string): boolean {
  const parsed = isParserReady() ? parseSql(sql) : null;
  if (!parsed?.ok || parsed.statements.length !== 1) return false;
  const sel = (parsed.statements[0].ast as { SelectStmt?: { fromClause?: unknown; targetList?: unknown } })
    .SelectStmt;
  return sel?.targetList != null && sel.fromClause == null;
}

// Ссылки на таблицы из разбора запроса. Парсер не готов или запрос не разобрался: пусто
function tableRefs(sql: string) {
  const parsed = isParserReady() ? parseSql(sql) : null;
  return parsed?.ok ? parsed.statements.flatMap((stmt) => relationsOf(stmt).tables) : [];
}

// Как таблицы названы в запросе: book → [b], self join book → [b1, b2], без алиаса - имя
function aliasesOf(sql: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const r of tableRefs(sql)) {
    const list = names.get(r.name) ?? [];
    if (!list.includes(r.alias ?? r.name)) list.push(r.alias ?? r.name);
    names.set(r.name, list);
  }
  return names;
}

// Есть ли GROUP BY у того SELECT, где стоит колонка ошибки (position Postgres, 1-based в кодовых
// точках): group by в подзапросе, CTE или комментарии не в счёт. Позиция не нашлась - внешний SELECT
function groupedAt(sql: string, position: number | undefined): boolean {
  const parsed = isParserReady() ? parseSql(sql) : null;
  if (!parsed?.ok || !parsed.statements.length) return false;
  const at =
    position == null
      ? -1
      : charToByte(
          sql,
          Array.from(sql)
            .slice(0, position - 1)
            .join('').length,
        );
  const grouped = (select: unknown) => Array.isArray((select as { groupClause?: unknown }).groupClause);
  const visit = (node: unknown, inGrouped: boolean): boolean | null => {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item, inGrouped);
        if (found !== null) return found;
      }
      return null;
    }
    const rec = node as Record<string, unknown>;
    if (rec.location === at) return inGrouped;
    for (const [key, value] of Object.entries(rec)) {
      // SelectStmt в обёртке, ветки UNION (larg, rarg) без неё
      const select = key === 'SelectStmt' || key === 'larg' || key === 'rarg';
      const found = visit(value, select ? grouped(value) : inGrouped);
      if (found !== null) return found;
    }
    return null;
  };
  const top = (parsed.statements[0].ast as { SelectStmt?: unknown }).SelectStmt;
  return visit(parsed.statements[0].ast, false) ?? (top != null && grouped(top));
}

// Таблица из подзапроса, внутри которой стоит позиция ошибки: имя и колонки SELECT
function derivedAt(sql: string, position: number | undefined): { alias: string; columns: string[] } | null {
  const parsed = isParserReady() ? parseSql(sql) : null;
  if (!parsed?.ok || !parsed.statements.length || position == null) return null;
  const at = charToByte(
    sql,
    Array.from(sql)
      .slice(0, position - 1)
      .join('').length,
  );
  const out: { scope: Record<string, unknown> | null } = { scope: null };
  const visit = (node: unknown, select: Record<string, unknown> | null) => {
    if (out.scope || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, select);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (rec.location === at) {
      out.scope = select;
      return;
    }
    for (const [key, value] of Object.entries(rec)) {
      const next =
        key === 'SelectStmt' || key === 'larg' || key === 'rarg'
          ? (value as Record<string, unknown>)
          : select;
      visit(value, next);
    }
  };
  visit(parsed.statements[0].ast, null);
  const from = (out.scope as { fromClause?: unknown[] } | null)?.fromClause;
  if (!Array.isArray(from) || from.length !== 1) return null;
  const sub = (
    from[0] as {
      RangeSubselect?: {
        alias?: { aliasname?: string };
        subquery?: { SelectStmt?: { targetList?: unknown[] } };
      };
    }
  ).RangeSubselect;
  const alias = sub?.alias?.aliasname;
  if (!sub || !alias) return null;
  const targets = sub.subquery?.SelectStmt?.targetList;
  const columns = Array.isArray(targets)
    ? targets.flatMap((t) => {
        const rt = (t as { ResTarget?: { name?: string; val?: Record<string, unknown> } }).ResTarget;
        if (!rt) return [];
        if (rt.name) return [rt.name];
        const fields =
          (rt.val as { ColumnRef?: { fields?: Array<{ String?: { sval?: string } }> } })?.ColumnRef?.fields ??
          [];
        const last = fields[fields.length - 1]?.String?.sval;
        return last ? [last] : [];
      })
    : [];
  return { alias, columns };
}

type SetOpBranch = { targetList?: unknown[]; larg?: SetOpBranch; rarg?: SetOpBranch };
type SetOpNode = SetOpBranch & { op?: string };

// Левая ветвь трёх и более UNION сама может быть SETOP без targetList: спускаемся до первого SELECT
function setOpBranchColumns(branch: SetOpBranch | undefined): number {
  if (!branch) return 0;
  if (Array.isArray(branch.targetList)) return branch.targetList.length;
  return setOpBranchColumns(branch.larg);
}

// Число колонок в ветвях верхнего UNION/INTERSECT/EXCEPT
function setOpColumns(sql: string): { op: string; left: number; right: number } | null {
  const parsed = isParserReady() ? parseSql(sql) : null;
  if (!parsed?.ok || !parsed.statements.length) return null;
  const find = (node: unknown): { op: string; left: number; right: number } | null => {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = find(item);
        if (found) return found;
      }
      return null;
    }
    const rec = node as Record<string, unknown>;
    const sel = (rec.SelectStmt ?? rec) as SetOpNode;
    if (sel.op && sel.op !== 'SETOP_NONE' && sel.larg && sel.rarg) {
      return {
        op: sel.op.replace('SETOP_', ''),
        left: setOpBranchColumns(sel.larg),
        right: setOpBranchColumns(sel.rarg),
      };
    }
    for (const value of Object.values(rec)) {
      const found = find(value);
      if (found) return found;
    }
    return null;
  };
  return find(parsed.statements[0].ast);
}

const columnId = (t: { schema?: string; table?: string }, column: string) =>
  `${t.schema ?? 'public'}.${t.table}.${column}`;
const tableId = (err: DbError) => `${err.schema ?? 'public'}.${err.table}`;

// Key (email)=(anna@example.com) → колонки и значения
function parseKey(detail = ''): { columns: string[]; values: string } | null {
  const m = /Key \(([^)]*)\)=\((.*)\)/.exec(detail);
  return m ? { columns: m[1].split(', '), values: m[2] } : null;
}

export const DICTIONARY: Record<string, Entry> = {
  '42P01': (err, ctx) => {
    const name = quoted(err.message);
    // invalid reference to FROM-clause entry: таблица есть, но в запросе у неё алиас
    if (err.message.startsWith('invalid reference to FROM-clause entry')) {
      const alias = /alias "([^"]+)"/.exec(err.hint ?? '')?.[1];
      // имя в кавычках может содержать спецсимволы регэкспа: экранируем
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const column = new RegExp(`\\b${escaped}\\.([a-z_][a-z0-9_]*)`, 'i').exec(ctx.sql)?.[1];
      const owner = ctx.schema?.tables.find((t) => t.name === name);
      return {
        title: alias
          ? tr(ctx, `Таблица ${name} здесь называется ${alias}`, `Table ${name} is called ${alias} here`)
          : tr(ctx, `К таблице ${name} отсюда не обратиться`, `Table ${name} cannot be referenced here`),
        body: alias
          ? tr(
              ctx,
              `В этом запросе у таблицы ${name} алиас ${alias}. После алиаса старое имя таблицы в запросе не работает.`,
              `This query gives ${name} the alias ${alias}. Once an alias is set, the original table name cannot be used in the query.`,
            )
          : tr(
              ctx,
              `Таблица ${name} есть в запросе, но в этом месте на неё ссылаться нельзя.`,
              `Table ${name} is in the query, but it cannot be referenced here.`,
            ),
        suggestion:
          alias && column
            ? tr(
                ctx,
                `Пиши ${alias}.${column} вместо ${name}.${column}.`,
                `Use ${alias}.${column} instead of ${name}.${column}.`,
              )
            : undefined,
        highlight: { tableIds: owner ? [owner.id] : [], columns: [] },
      };
    }
    // missing FROM-clause entry: перед точкой имя, которого нет в FROM (алиас с опечаткой, таблица без JOIN)
    if (err.message.startsWith('missing FROM-clause entry')) {
      const refs = tableRefs(ctx.sql);
      const visible = [...new Set(refs.map((r) => r.alias ?? r.name))];
      const known = ctx.schema?.tables.some((t) => t.name === name);
      const inFrom = ctx.schema?.tables.filter((t) => refs.some((r) => r.name === t.name)) ?? [];
      return {
        title: tr(ctx, `${name} нет в FROM`, `${name} is not in FROM`),
        body: tr(
          ctx,
          `Перед точкой стоит ${name}, но в FROM нет ни таблицы, ни алиаса с таким именем. Колонки берутся только из таблиц FROM и JOIN.`,
          `${name} appears before the dot, but FROM has no table or alias by that name. Columns come from tables in FROM and JOIN.`,
        ),
        suggestion: known
          ? tr(
              ctx,
              `Таблица ${name} есть в базе: добавь её в FROM или JOIN.`,
              `Table ${name} exists in the database: add it to FROM or JOIN.`,
            )
          : visible.length
            ? tr(ctx, `В FROM есть: ${visible.join(', ')}.`, `Available in FROM: ${visible.join(', ')}.`)
            : undefined,
        highlight: { tableIds: inFrom.map((t) => t.id), columns: [] },
      };
    }
    const names = ctx.schema?.tables.map((t) => t.name) ?? [];
    const guess = closest(name, names);
    return {
      title: tr(ctx, `Таблицы ${name} нет`, `Table ${name} does not exist`),
      body: names.length
        ? tr(
            ctx,
            `Postgres не нашёл таблицу ${name}. Есть: ${names.join(', ')}.`,
            `Postgres could not find table ${name}. Available tables: ${names.join(', ')}.`,
          )
        : tr(
            ctx,
            `Postgres не нашёл таблицу ${name}. В базе пока нет ни одной таблицы.`,
            `Postgres could not find table ${name}. The database has no tables yet.`,
          ),
      suggestion: guess ? tr(ctx, `Может, ${guess}?`, `Did you mean ${guess}?`) : undefined,
      fix: guess ? { from: name, to: guess } : undefined,
      highlight: { tableIds: ctx.schema?.tables.map((t) => t.id) ?? [], columns: [] },
    };
  },

  '42703': (err, ctx) => {
    // column "nme" does not exist или column b.nme does not exist
    const raw = /column (?:"([^"]+)"|(\S+)) does not exist/.exec(err.message);
    const name = (raw?.[1] ?? raw?.[2] ?? '').replace(/^.*\./, '');
    if (selectWithoutFrom(ctx.sql)) {
      const owners = ctx.schema?.tables.filter((t) => t.columns.some((c) => c.name === name)) ?? [];
      return {
        title: tr(ctx, 'Запрос без FROM', 'Query without FROM'),
        body: tr(
          ctx,
          `Колонку ${name} Postgres ищет в таблицах из FROM, а FROM в запросе нет.`,
          `Postgres looks for column ${name} in FROM tables, but this query has no FROM clause.`,
        ),
        suggestion: owners.length
          ? tr(
              ctx,
              `${name} есть в ${owners.map((t) => t.name).join(' и ')}: допиши from ${owners[0].name}.`,
              `${name} is in ${owners.map((t) => t.name).join(' and ')}: add from ${owners[0].name}.`,
            )
          : tr(
              ctx,
              'Допиши FROM и таблицу, из которой брать колонки.',
              'Add FROM and the table containing the columns.',
            ),
        highlight: {
          tableIds: owners.map((t) => t.id),
          columns: owners.map((t) => `${t.id}.${name}`),
        },
      };
    }
    const derived = derivedAt(ctx.sql, err.position);
    if (derived) {
      const guess = closest(name, derived.columns);
      const list = derived.columns.length ? `: в ней ${derived.columns.join(', ')}` : '';
      return {
        title: tr(ctx, `Колонки ${name} нет`, `Column ${name} does not exist`),
        body: tr(
          ctx,
          `Снаружи от подзапроса видна таблица ${derived.alias}${list}. Колонки ${name} там нет.`,
          `The outer query sees the subquery's table ${derived.alias}${derived.columns.length ? ` with ${derived.columns.join(', ')}` : ''}. Column ${name} is not in it.`,
        ),
        suggestion: guess
          ? tr(ctx, `Может, ${guess}?`, `Did you mean ${guess}?`)
          : tr(
              ctx,
              `Добавь ${name} в SELECT подзапроса или исправь имя.`,
              `Add ${name} to the subquery's SELECT or fix the name.`,
            ),
        fix: guess ? { from: name, to: guess } : undefined,
        highlight: none,
      };
    }
    const tables = tablesInSql(ctx);
    const guess = closest(
      name,
      tables.flatMap((t) => t.columns.map((c) => c.name)),
    );
    const asString = ctx.sql.includes(`"${name}"`);
    return {
      title: tr(ctx, `Колонки ${name} нет`, `Column ${name} does not exist`),
      // заголовок уже сказал «Колонки X нет»: тело только добавляет, где искали
      body: asString
        ? tr(
            ctx,
            'В двойных кавычках Postgres видит имя колонки, а не строку.',
            'Postgres treats double-quoted text as a column name, not a string.',
          )
        : tables.length
          ? tr(
              ctx,
              `Postgres искал её в ${tables.map((t) => t.name).join(', ')}.`,
              `Postgres looked for it in ${tables.map((t) => t.name).join(', ')}.`,
            )
          : '',
      suggestion: asString
        ? tr(
            ctx,
            `Строку пишут в одинарных кавычках: '${name}'.`,
            `Write a string in single quotes: '${name}'.`,
          )
        : guess
          ? tr(ctx, `Может, ${guess}?`, `Did you mean ${guess}?`)
          : undefined,
      fix: !asString && guess ? { from: name, to: guess } : undefined,
      highlight: {
        tableIds: tables.map((t) => t.id),
        columns: tables.flatMap((t) => t.columns.map((c) => `${t.id}.${c.name}`)),
      },
    };
  },

  '42702': (err, ctx) => {
    const name = quoted(err.message);
    const owners = tablesInSql(ctx).filter((t) => t.columns.some((c) => c.name === name));
    const aliases = aliasesOf(ctx.sql);
    const refs = owners.flatMap((t) => aliases.get(t.name) ?? [t.name]);
    return {
      title: tr(ctx, `Непонятно, какая ${name}`, `Column ${name} is ambiguous`),
      body:
        owners.length > 1
          ? tr(
              ctx,
              `Колонка ${name} есть и в ${owners.map((t) => t.name).join(', и в ')}. Postgres не угадывает, из какой таблицы её брать.`,
              `Column ${name} exists in ${owners.map((t) => t.name).join(', ')}. Postgres cannot tell which table to use.`,
            )
          : refs.length > 1
            ? tr(
                ctx,
                `Колонка ${name} есть и в ${refs.join(', и в ')}: это одна таблица ${owners[0].name}, взятая ${refs.length === 2 ? 'дважды' : 'несколько раз'}. Postgres не угадывает, из какой копии её брать.`,
                `Column ${name} exists in ${refs.join(', ')}: these are copies of table ${owners[0].name}. Postgres cannot tell which copy to use.`,
              )
            : tr(
                ctx,
                `Колонка ${name} есть в нескольких таблицах запроса. Postgres не угадывает, из какой её брать.`,
                `Column ${name} exists in several tables in the query. Postgres cannot tell which table to use.`,
              ),
      suggestion: refs.length
        ? tr(
            ctx,
            `Укажи таблицу: ${refs.map((r) => `${r}.${name}`).join(' или ')}.`,
            `Specify the table: ${refs.map((r) => `${r}.${name}`).join(' or ')}.`,
          )
        : tr(
            ctx,
            'Укажи таблицу или алиас перед именем колонки.',
            'Put a table name or alias before the column name.',
          ),
      highlight: { tableIds: owners.map((t) => t.id), columns: owners.map((t) => `${t.id}.${name}`) },
    };
  },

  '42803': (err, ctx) => {
    // GROUPING: его аргументы и место в запросе проверяются отдельно от агрегатов
    if (err.message.startsWith('grouping operations are not allowed in WHERE'))
      return {
        title: tr(ctx, 'GROUPING в WHERE', 'GROUPING in WHERE'),
        body: tr(
          ctx,
          'GROUPING вычисляется на шаге группировки, а WHERE идёт раньше. Проверить уровень в WHERE нельзя.',
          'GROUPING is evaluated during grouping, while WHERE runs before it. A level cannot be tested in WHERE.',
        ),
        suggestion: tr(ctx, 'Перенеси условие в HAVING.', 'Move the condition to HAVING.'),
        highlight: none,
      };
    if (err.message.startsWith('arguments to GROUPING must be grouping expressions')) {
      const arg = groupingArgumentText(ctx.sql, err.position);
      return {
        title: tr(ctx, 'GROUPING не видит выражение', 'GROUPING cannot see the expression'),
        body: tr(
          ctx,
          arg
            ? `Аргумент GROUPING: выражение «${arg}». Его нет в GROUP BY.`
            : 'Аргумент GROUPING должен быть выражением из GROUP BY.',
          arg
            ? `The GROUPING argument is the expression “${arg}”. It is not in GROUP BY.`
            : 'An argument to GROUPING must be a grouping expression.',
        ),
        suggestion: tr(
          ctx,
          arg
            ? `Добавь «${arg}» в GROUP BY или убери из GROUPING.`
            : 'Бери в GROUPING только выражения из GROUP BY.',
          arg
            ? `Add “${arg}” to GROUP BY or remove it from GROUPING.`
            : 'Pass only GROUP BY expressions to GROUPING.',
        ),
        highlight: none,
      };
    }
    if (err.message.startsWith('grouping operations are not allowed in JOIN conditions'))
      return {
        title: tr(ctx, 'GROUPING в JOIN', 'GROUPING in JOIN'),
        body: tr(
          ctx,
          'GROUPING вычисляется на шаге группировки, а JOIN идёт раньше. В условии JOIN его использовать нельзя.',
          'GROUPING is evaluated during grouping, while JOIN runs before it. It cannot appear in a JOIN condition.',
        ),
        suggestion: tr(ctx, 'Перенеси условие в HAVING.', 'Move the condition to HAVING.'),
        highlight: none,
      };
    if (err.message.startsWith('grouping operations are not allowed in GROUP BY'))
      return {
        title: tr(ctx, 'GROUPING в GROUP BY', 'GROUPING in GROUP BY'),
        body: tr(
          ctx,
          'GROUPING вычисляется после группировки, а GROUP BY задаёт её уровни. Внутри GROUP BY его нет.',
          'GROUPING is evaluated after grouping, while GROUP BY defines the levels. It cannot appear inside GROUP BY.',
        ),
        suggestion: tr(
          ctx,
          'Используй GROUPING в SELECT, HAVING или ORDER BY.',
          'Use GROUPING in SELECT, HAVING or ORDER BY.',
        ),
        highlight: none,
      };
    // Тот же код без колонки в тексте: aggregate functions are not allowed in WHERE, вложенный агрегат и т.п.
    if (!quoted(err.message))
      return /not allowed in WHERE/.test(err.message)
        ? {
            title: tr(ctx, 'Агрегат в WHERE', 'Aggregate in WHERE'),
            body: tr(
              ctx,
              'WHERE решает, какие строки попадут в агрегат, поэтому выполняется раньше него. Посчитать max или count внутри WHERE нельзя.',
              'WHERE chooses rows before aggregation, so it cannot calculate max or count.',
            ),
            suggestion: tr(
              ctx,
              'Условие на агрегат пиши в HAVING, а строку с самым большим значением найди сортировкой или подзапросом.',
              'Put conditions on aggregates in HAVING. Use sorting or a subquery to find the row with the largest value.',
            ),
            highlight: none,
          }
        : {
            title: tr(ctx, 'Агрегат здесь нельзя', 'Aggregate not allowed here'),
            body: tr(
              ctx,
              'В этом месте запроса агрегатная функция не допускается.',
              'An aggregate function is not allowed at this point in the query.',
            ),
            highlight: none,
          };
    // column "book.title" must appear in the GROUP BY clause ...
    const [table, column] = quoted(err.message).split('.');
    const owner = ctx.schema?.tables.find((t) => t.name === table);
    return {
      title: tr(ctx, 'Колонка вне GROUP BY', 'Column outside GROUP BY'),
      body: groupedAt(ctx.sql, err.position)
        ? tr(
            ctx,
            `После GROUP BY от каждой группы остаётся одна строка. ${table}.${column} в группе может быть разным, и Postgres не знает, какое значение показать.`,
            `GROUP BY produces one row per group. ${table}.${column} can vary within a group, so Postgres does not know which value to show.`,
          )
        : tr(
            ctx,
            `Агрегат без GROUP BY сворачивает все строки в одну. ${table}.${column} у строк разный, и Postgres не знает, какое значение показать.`,
            `An aggregate without GROUP BY combines all rows into one. ${table}.${column} can vary between rows, so Postgres does not know which value to show.`,
          ),
      suggestion: tr(
        ctx,
        `Добавь ${table}.${column} в GROUP BY или оберни в агрегат, например max(${table}.${column}).`,
        `Add ${table}.${column} to GROUP BY or use an aggregate such as max(${table}.${column}).`,
      ),
      highlight: { tableIds: owner ? [owner.id] : [], columns: owner ? [`${owner.id}.${column}`] : [] },
    };
  },

  '42P20': (err, ctx) => ({
    title: err.message.startsWith('RANGE with offset')
      ? tr(ctx, 'RANGE со смещением', 'RANGE with an offset')
      : tr(ctx, 'Недопустимая рамка окна', 'Invalid window frame'),
    body: err.message.startsWith('RANGE with offset')
      ? err.message.includes('exactly one ORDER BY column')
        ? tr(
            ctx,
            'Смещение в RANGE считается по ключу сортировки, поэтому нужен ровно один ключ ORDER BY. Сейчас их ноль или несколько.',
            'A RANGE offset is measured along the ordering key, so it needs exactly one ORDER BY column. This window has zero or several.',
          )
        : tr(
            ctx,
            'Смещение в RANGE не подходит к типу ключа сортировки.',
            'The RANGE offset does not fit the ordering column type.',
          )
      : err.message.startsWith('frame starting from following row')
        ? tr(
            ctx,
            'Начало рамки не может стоять позже её конца. Сначала идёт начало, потом конец.',
            'The frame start cannot come after its end. The start comes before the end.',
          )
        : err.message.startsWith('frame starting from current row')
          ? tr(
              ctx,
              'Рамка, которая начинается с текущей строки, не может заканчиваться раньше неё.',
              'A frame starting at the current row cannot end before it.',
            )
          : tr(ctx, 'Границы рамки окна недопустимы.', 'The window frame bounds are invalid.'),
    suggestion: err.message.startsWith('RANGE with offset')
      ? tr(
          ctx,
          'Добавь один ключ в ORDER BY окна или оставь только один; если нужны строки, используй ROWS.',
          'Add one ORDER BY column to the window or keep just one; use ROWS when you mean row positions.',
        )
      : tr(
          ctx,
          'Задай начало раньше конца, например rows between 1 preceding and 1 following.',
          'Put the start before the end, for example rows between 1 preceding and 1 following.',
        ),
    highlight: none,
  }),

  '42601': (err, ctx) => {
    if (/each (UNION|INTERSECT|EXCEPT) query must have the same number of columns/.test(err.message)) {
      const op = /each (UNION|INTERSECT|EXCEPT) query/.exec(err.message)?.[1] ?? 'UNION';
      const counts = setOpColumns(ctx.sql);
      return {
        title: tr(ctx, 'Разное число колонок', 'Different number of columns'),
        body: counts
          ? tr(
              ctx,
              `В ветвях ${op} разное число колонок: слева ${counts.left}, справа ${counts.right}.`,
              `The ${op} branches have different column counts: ${counts.left} on the left and ${counts.right} on the right.`,
            )
          : tr(
              ctx,
              `В ветвях ${op} должно быть одинаковое число колонок.`,
              `Both ${op} branches must have the same number of columns.`,
            ),
        suggestion: tr(
          ctx,
          'Добавь или убери колонку, чтобы списки совпали.',
          'Add or remove a column so both lists match.',
        ),
        highlight: none,
      };
    }
    const near = quoted(err.message);
    const sql = ctx.sql;
    const suggestion = /\bform\b/i.test(sql)
      ? tr(ctx, 'Похоже на опечатку: FORM вместо FROM.', 'Possible typo: FORM instead of FROM.')
      : near.toLowerCase() === 'from' && /,\s*from\b/i.test(sql)
        ? tr(ctx, 'Лишняя запятая перед FROM.', 'Remove the extra comma before FROM.')
        : /==/.test(sql)
          ? tr(ctx, 'Сравнение в SQL пишется одним знаком: =.', 'Use a single equals sign for comparison: =.')
          : undefined;
    return {
      title: tr(ctx, 'Синтаксическая ошибка', 'Syntax error'),
      body: near
        ? tr(
            ctx,
            `Postgres не понял запрос в месте «${near}». Обычно ошибка прямо перед этим словом.`,
            `Postgres could not understand the query near “${near}”. The mistake is often just before this word.`,
          )
        : tr(
            ctx,
            'Запрос оборвался раньше, чем Postgres ожидал.',
            'The query ended earlier than Postgres expected.',
          ),
      suggestion,
      highlight: none,
    };
  },

  '42883': (err, ctx) => {
    const op = err.message.includes('==');
    return {
      title: op
        ? tr(ctx, 'Нет оператора ==', 'Operator == does not exist')
        : tr(ctx, 'Нет такой функции или оператора', 'Function or operator does not exist'),
      body: op
        ? tr(ctx, 'В SQL нет оператора ==.', 'SQL has no == operator.')
        : tr(
            ctx,
            'Postgres ищет функцию по имени и типам аргументов. С такими типами её нет.',
            'Postgres looks up a function by its name and argument types. No match exists for these types.',
          ),
      suggestion: op
        ? tr(ctx, 'Сравнение пишется одним знаком: =.', 'Use a single equals sign for comparison: =.')
        : tr(
            ctx,
            'Проверь имя и приведи аргумент к нужному типу, например pages::text.',
            'Check the name and cast the argument to the right type, for example pages::text.',
          ),
      highlight: none,
    };
  },

  '42804': (err, ctx) => ({
    title: tr(ctx, 'Не тот тип', 'Wrong type'),
    body: err.message.startsWith('argument of WHERE')
      ? tr(
          ctx,
          'WHERE ждёт условие, которое даёт true или false, а получил число или строку.',
          'WHERE expects a condition that returns true or false, but received a number or string.',
        )
      : tr(
          ctx,
          'Тип значения не подходит туда, куда его подставили.',
          'The value has the wrong type for this position.',
        ),
    suggestion: err.message.startsWith('argument of WHERE')
      ? tr(
          ctx,
          'Допиши сравнение: например, where price > 500.',
          'Add a comparison, for example where price > 500.',
        )
      : tr(
          ctx,
          'Приведи значение к нужному типу через ::тип.',
          'Cast the value to the required type with ::type.',
        ),
    highlight: none,
  }),

  '42P07': (err, ctx) => {
    const name = quoted(err.message);
    const t = ctx.schema?.tables.find((x) => x.name === name);
    return {
      title: tr(ctx, `${name} уже есть`, `${name} already exists`),
      body: tr(
        ctx,
        `Объект с именем ${name} уже создан в этой схеме.`,
        `An object named ${name} already exists in this schema.`,
      ),
      suggestion: tr(
        ctx,
        'Выбери другое имя или напиши CREATE TABLE IF NOT EXISTS.',
        'Choose another name or use CREATE TABLE IF NOT EXISTS.',
      ),
      highlight: { tableIds: t ? [t.id] : [], columns: [] },
    };
  },

  '23505': (err, ctx) => {
    const key = parseKey(err.detail);
    const creatingIndex = /could not create unique index/i.test(err.message);
    return {
      title: tr(ctx, 'Такое значение уже есть', 'This value already exists'),
      body: creatingIndex
        ? tr(
            ctx,
            `Уникальный индекс ${quoted(err.message)} не создан: в таблице есть повторяющиеся значения.`,
            `Unique index ${quoted(err.message)} was not created because the table contains duplicate values.`,
          )
        : key
          ? tr(
              ctx,
              `Ограничение ${err.constraint} требует уникальности: (${key.values}) в ${key.columns.join(', ')} уже есть в ${err.table}.`,
              `Constraint ${err.constraint} requires unique values: (${key.values}) in ${key.columns.join(', ')} already exists in ${err.table}.`,
            )
          : tr(
              ctx,
              `Ограничение ${err.constraint} требует уникальности.`,
              `Constraint ${err.constraint} requires unique values.`,
            ),
      suggestion: creatingIndex
        ? tr(
            ctx,
            'Проверь повторяющиеся значения и устрани их перед созданием индекса.',
            'Find and remove duplicate values before creating the index.',
          )
        : tr(
            ctx,
            'Возьми другое значение или используй INSERT ... ON CONFLICT.',
            'Use a different value or INSERT ... ON CONFLICT.',
          ),
      highlight: { tableIds: [tableId(err)], columns: key?.columns.map((c) => columnId(err, c)) ?? [] },
    };
  },

  '23503': (err, ctx) => {
    const key = parseKey(err.detail);
    const referenced = /still referenced from table "([^"]+)"/.exec(err.detail ?? '')?.[1];
    return {
      title: referenced
        ? tr(ctx, 'На строку ещё ссылаются', 'Other rows still reference this row')
        : tr(ctx, 'Ссылка в никуда', 'Referenced row does not exist'),
      body: referenced
        ? tr(
            ctx,
            `Строку с (${key?.values}) нельзя удалить или изменить: на неё ссылается ${referenced} через ${err.constraint}.`,
            `The row with (${key?.values}) cannot be deleted or changed: ${referenced} references it through ${err.constraint}.`,
          )
        : tr(
            ctx,
            `Значения (${key?.values}) нет в таблице, на которую ссылается ${err.constraint}.`,
            `The value (${key?.values}) is missing from the table referenced by ${err.constraint}.`,
          ),
      suggestion: referenced
        ? tr(
            ctx,
            `Сначала удали строки в ${referenced} или объяви внешний ключ с ON DELETE CASCADE.`,
            `First delete the rows in ${referenced}, or define the foreign key with ON DELETE CASCADE.`,
          )
        : tr(
            ctx,
            'Сначала добавь строку в родительскую таблицу или поправь значение.',
            'First add the row to the parent table or correct the value.',
          ),
      highlight: { tableIds: [tableId(err)], columns: key?.columns.map((c) => columnId(err, c)) ?? [] },
    };
  },

  '23502': (err, ctx) =>
    err.message.includes('contains null values')
      ? {
          title: tr(
            ctx,
            `${err.column ?? quoted(err.message)} содержит NULL`,
            `${err.column ?? quoted(err.message)} contains NULL`,
          ),
          body: tr(
            ctx,
            'В существующих строках этой колонки есть NULL, поэтому Postgres не может добавить NOT NULL.',
            'Existing rows contain NULL in this column, so Postgres cannot add NOT NULL.',
          ),
          suggestion: tr(
            ctx,
            'Сначала замени NULL подходящими значениями или удали такие строки, затем повтори SET NOT NULL.',
            'Replace the NULLs with suitable values or delete those rows, then retry SET NOT NULL.',
          ),
          highlight: {
            tableIds: err.table ? [tableId(err)] : [],
            columns: err.table && err.column ? [columnId(err, err.column)] : [],
          },
        }
      : {
          title: tr(ctx, `${err.column} не может быть пустым`, `${err.column} cannot be NULL`),
          body: tr(
            ctx,
            `У колонки ${err.column} в ${err.table} стоит NOT NULL, а строка пришла с NULL.`,
            `Column ${err.column} in ${err.table} is NOT NULL, but the row contains NULL.`,
          ),
          suggestion: tr(
            ctx,
            `Передай значение для ${err.column} или задай колонке DEFAULT.`,
            `Provide a value for ${err.column} or set a DEFAULT for the column.`,
          ),
          highlight: { tableIds: [tableId(err)], columns: [columnId(err, err.column ?? '')] },
        },

  '23514': (err, ctx) => {
    if (/^no partition of relation .+ found for row/i.test(err.message)) {
      const name = err.table ?? quoted(err.message);
      const schema = err.schema?.startsWith('pg_temp_') ? 'pg_temp' : (err.schema ?? 'public');
      return {
        title: tr(ctx, 'Нет подходящей секции', 'No matching partition'),
        body: tr(
          ctx,
          `Для строки не найдена секция таблицы ${name}.`,
          `No partition of ${name} matches this row.`,
        ),
        suggestion: tr(
          ctx,
          'Проверь значение ключа и диапазоны секций или создай подходящую секцию.',
          'Check the partition key and ranges, or create a matching partition.',
        ),
        highlight: { tableIds: name ? [`${schema}.${name}`] : [], columns: [] },
      };
    }
    // имя по умолчанию: <таблица>_<колонка>_check
    const column = err.constraint?.replace(`${err.table}_`, '').replace(/_check$/, '');
    const owner = ctx.schema?.tables.find((t) => t.id === tableId(err));
    const col = owner?.columns.find((c) => c.name === column);
    return {
      title: tr(ctx, 'Нарушено условие CHECK', 'CHECK constraint violated'),
      body: tr(
        ctx,
        `Строка не прошла проверку ${err.constraint}${col?.checks.length ? `: ${col.checks.join(', ')}` : ''}.`,
        `The row failed ${err.constraint}${col?.checks.length ? `: ${col.checks.join(', ')}` : ''}.`,
      ),
      suggestion: tr(
        ctx,
        'Поправь значение так, чтобы условие выполнялось.',
        'Change the value so that it satisfies the condition.',
      ),
      highlight: { tableIds: [tableId(err)], columns: col ? [columnId(err, col.name)] : [] },
    };
  },

  '428C9': (err, ctx) => {
    // cannot insert a non-DEFAULT value into column "x" или column "x" can only be updated to DEFAULT;
    // detail различает identity GENERATED ALWAYS и вычисляемую колонку
    const name = quoted(err.message);
    const identity = err.detail?.includes('identity column') ?? false;
    const owners = tablesInSql(ctx).filter((t) => t.columns.some((c) => c.name === name));
    return {
      title: tr(ctx, `${name} заполняет сам Postgres`, `Postgres fills ${name} automatically`),
      body: identity
        ? tr(
            ctx,
            `Колонка ${name} объявлена как GENERATED ALWAYS AS IDENTITY: номер для неё выдаёт Postgres, а явное значение требует специального указания.`,
            `Column ${name} is GENERATED ALWAYS AS IDENTITY: Postgres supplies its number unless an explicit override is used.`,
          )
        : tr(
            ctx,
            `Колонка ${name} вычисляемая (GENERATED ALWAYS AS): Postgres считает её сам из других колонок.`,
            `Column ${name} is generated (GENERATED ALWAYS AS): Postgres calculates it from other columns.`,
          ),
      suggestion: !identity
        ? tr(
            ctx,
            `Убери ${name} из запроса или передай DEFAULT.`,
            `Remove ${name} from the query or use DEFAULT.`,
          )
        : err.message.includes('updated')
          ? tr(
              ctx,
              `Убери ${name} из SET: номер строки менять не нужно. Нужен новый номер из последовательности: SET ${name} = DEFAULT.`,
              `Remove ${name} from SET if the number should stay unchanged. To get a new sequence value, use SET ${name} = DEFAULT.`,
            )
          : tr(
              ctx,
              `Убери ${name} из INSERT, номер появится сам. Нужен именно свой номер: допиши OVERRIDING SYSTEM VALUE перед VALUES.`,
              `Remove ${name} from INSERT to generate the number. To use your own number, add OVERRIDING SYSTEM VALUE before VALUES.`,
            ),
      highlight: { tableIds: owners.map((t) => t.id), columns: owners.map((t) => `${t.id}.${name}`) },
    };
  },

  '22012': (_err, ctx) => ({
    title: tr(ctx, 'Деление на ноль', 'Division by zero'),
    body: tr(ctx, 'В одной из строк делитель равен нулю.', 'The divisor is zero in at least one row.'),
    suggestion: tr(
      ctx,
      'Оберни делитель в nullif(x, 0): тогда результат будет NULL вместо ошибки.',
      'Wrap the divisor in nullif(x, 0) to get NULL instead of an error.',
    ),
    highlight: none,
  }),

  '22P02': (err, ctx) => ({
    title: tr(ctx, 'Значение не того формата', 'Invalid value format'),
    body: tr(
      ctx,
      `Postgres не смог превратить ${quoted(err.message) || 'значение'} в нужный тип: ${err.message.replace(/^invalid input syntax for type (\S+).*$/, '$1')}.`,
      `Postgres could not convert ${quoted(err.message) || 'the value'} to the required type: ${err.message.replace(/^invalid input syntax for type (\S+).*$/, '$1')}.`,
    ),
    suggestion: tr(ctx, 'Проверь кавычки и формат значения.', 'Check the quotes and value format.'),
    highlight: none,
  }),

  '21000': (err, ctx) =>
    /(?:ON CONFLICT DO UPDATE|MERGE).*cannot affect row a second time/i.test(err.message)
      ? {
          title: tr(ctx, 'Строка изменяется дважды', 'Row changed more than once'),
          body: tr(
            ctx,
            'Один запрос пытается изменить одну и ту же строку больше одного раза.',
            'One query is trying to change the same row more than once.',
          ),
          suggestion: err.message.startsWith('MERGE')
            ? tr(
                ctx,
                'Проверь условие соединения и оставь не больше одной строки источника для каждой строки цели.',
                'Check the join condition and keep at most one source row per target row.',
              )
            : tr(
                ctx,
                'Убери повторы ключа из вставляемых строк перед ON CONFLICT DO UPDATE.',
                'Remove duplicate keys from the inserted rows before ON CONFLICT DO UPDATE.',
              ),
          highlight: none,
        }
      : {
          title: tr(ctx, 'Подзапрос вернул больше одной строки', 'Subquery returned more than one row'),
          body: tr(
            ctx,
            'Подзапрос стоит на месте одного значения, а вернул несколько строк.',
            'The subquery is used as one value but returned several rows.',
          ),
          suggestion: tr(
            ctx,
            'Используй IN или EXISTS, добавь агрегат или условие, после которого останется одна строка.',
            'Use IN or EXISTS, add an aggregate, or add a condition that leaves one row.',
          ),
          highlight: none,
        },

  '2BP01': (_err, ctx) => ({
    title: tr(ctx, 'Есть зависимые объекты', 'Dependent objects exist'),
    body: tr(
      ctx,
      'Postgres не удалил объект: от него зависят другие объекты базы.',
      'Postgres did not drop the object because other database objects depend on it.',
    ),
    suggestion: tr(
      ctx,
      'Сначала удали зависимости или используй CASCADE, чтобы удалить их вместе с объектом.',
      'Drop the dependent objects first, or use CASCADE to drop them together.',
    ),
    highlight: none,
  }),

  '0A000': (err, ctx) =>
    /cannot truncate a table referenced in a foreign key/i.test(err.message)
      ? {
          title: tr(ctx, 'Таблица связана внешним ключом', 'Table is referenced by a foreign key'),
          body: tr(
            ctx,
            'TRUNCATE не может очистить таблицу отдельно: на неё ссылается другая таблица.',
            'TRUNCATE cannot clear this table alone because another table references it.',
          ),
          suggestion: tr(
            ctx,
            'Укажи связанные таблицы вместе или используй TRUNCATE ... CASCADE: он очистит и зависимые таблицы.',
            'List the related tables together, or use TRUNCATE ... CASCADE to clear the dependent tables too.',
          ),
          highlight: none,
        }
      : {
          title: tr(ctx, 'Операция не поддерживается', 'Operation not supported'),
          body: tr(
            ctx,
            'Postgres не поддерживает эту операцию в указанном виде.',
            'Postgres does not support this operation in its current form.',
          ),
          highlight: none,
        },

  '23001': (_err, ctx) => ({
    title: tr(ctx, 'Изменение запрещено внешним ключом', 'Foreign key prevents this change'),
    body: tr(
      ctx,
      'На строку ссылаются другие строки, а внешний ключ запрещает удаление или изменение через RESTRICT.',
      'Other rows reference this row, and the foreign key uses RESTRICT to prevent deletion or changes.',
    ),
    suggestion: tr(
      ctx,
      'Сначала измени или удали ссылающиеся строки, затем повтори запрос.',
      'Change or delete the referencing rows first, then retry the query.',
    ),
    highlight: none,
  }),

  '42P10': (err, ctx) =>
    /no unique or exclusion constraint matching.*ON CONFLICT/i.test(err.message)
      ? {
          title: tr(ctx, 'Нет ограничения для ON CONFLICT', 'No constraint for ON CONFLICT'),
          body: tr(
            ctx,
            'Указанные колонки не совпадают с подходящим уникальным ограничением или индексом.',
            'The specified columns do not match a suitable unique constraint or index.',
          ),
          suggestion: tr(
            ctx,
            'Укажи подходящий уникальный ключ или создай нужное ограничение уникальности.',
            'Use a suitable unique key or create the required unique constraint.',
          ),
          highlight: none,
        }
      : {
          title: tr(ctx, 'Недопустимая ссылка на колонку', 'Invalid column reference'),
          body: tr(
            ctx,
            'Ссылка на колонку не подходит для этого места запроса.',
            'This column reference is not valid at this point in the query.',
          ),
          highlight: none,
        },

  '42830': (_err, ctx) => ({
    title: tr(ctx, 'Внешнему ключу нужен уникальный ключ', 'Foreign key needs a unique key'),
    body: tr(
      ctx,
      'Колонки, на которые ссылается внешний ключ, не образуют подходящий первичный или уникальный ключ.',
      'The referenced columns do not form a suitable primary or unique key.',
    ),
    suggestion: tr(
      ctx,
      'Укажи существующий ключ или добавь подходящее ограничение UNIQUE.',
      'Reference an existing key or add a suitable UNIQUE constraint.',
    ),
    highlight: none,
  }),

  '3F000': (err, ctx) => ({
    title: tr(ctx, 'Схема не найдена', 'Schema not found'),
    body: quoted(err.message)
      ? tr(
          ctx,
          `Схемы ${quoted(err.message)} нет в базе.`,
          `Schema ${quoted(err.message)} is not in the database.`,
        )
      : tr(ctx, 'Указанной схемы нет в базе.', 'The specified schema is not in the database.'),
    suggestion: tr(
      ctx,
      'Проверь имя схемы или создай её командой CREATE SCHEMA.',
      'Check the schema name or create it with CREATE SCHEMA.',
    ),
    highlight: none,
  }),

  '42P06': (err, ctx) => ({
    title: tr(ctx, 'Схема уже существует', 'Schema already exists'),
    body: quoted(err.message)
      ? tr(
          ctx,
          `Схема ${quoted(err.message)} уже есть в базе.`,
          `Schema ${quoted(err.message)} already exists in the database.`,
        )
      : tr(
          ctx,
          'Схема с таким именем уже есть в базе.',
          'A schema with this name already exists in the database.',
        ),
    suggestion: tr(
      ctx,
      'Выбери другое имя или используй CREATE SCHEMA IF NOT EXISTS.',
      'Choose another name or use CREATE SCHEMA IF NOT EXISTS.',
    ),
    highlight: none,
  }),

  '42809': (_err, ctx) => ({
    title: tr(ctx, 'Не тот тип объекта', 'Wrong object type'),
    body: tr(
      ctx,
      'Команда ожидает объект другого типа, например представление вместо таблицы.',
      'The command expects a different object type, such as a view instead of a table.',
    ),
    suggestion: tr(
      ctx,
      'Проверь тип объекта и выбери соответствующую команду.',
      'Check the object type and choose the matching command.',
    ),
    highlight: none,
  }),

  '55000': (err, ctx) =>
    /currval.*not yet defined/i.test(err.message)
      ? {
          title: tr(ctx, 'Последовательность ещё не использована', 'Sequence has not been used yet'),
          body: tr(
            ctx,
            'В этой сессии ещё не вызывали nextval для последовательности, поэтому currval не знает её значения.',
            'This session has not called nextval for the sequence, so currval does not know its value.',
          ),
          suggestion: tr(
            ctx,
            'Сначала вызови nextval для этой последовательности.',
            'Call nextval for this sequence first.',
          ),
          highlight: none,
        }
      : {
          title: tr(ctx, 'Объект не готов к операции', 'Object is not ready for this operation'),
          body: tr(
            ctx,
            'Текущее состояние объекта не позволяет выполнить команду.',
            'The current state of the object does not allow this command.',
          ),
          highlight: none,
        },

  '42701': (err, ctx) => ({
    title: tr(ctx, 'Колонка уже существует', 'Column already exists'),
    body: quoted(err.message)
      ? tr(
          ctx,
          `Колонка ${quoted(err.message)} уже есть в таблице.`,
          `Column ${quoted(err.message)} already exists in the table.`,
        )
      : tr(
          ctx,
          'Колонка с таким именем уже есть в таблице.',
          'A column with this name already exists in the table.',
        ),
    suggestion: tr(
      ctx,
      'Выбери другое имя или используй ADD COLUMN IF NOT EXISTS.',
      'Choose another name or use ADD COLUMN IF NOT EXISTS.',
    ),
    highlight: none,
  }),

  '42704': (_err, ctx) => ({
    title: tr(ctx, 'Объект не найден', 'Object not found'),
    body: tr(
      ctx,
      'Postgres не нашёл указанный объект, например ограничение или тип.',
      'Postgres could not find the specified object, such as a constraint or type.',
    ),
    suggestion: tr(ctx, 'Проверь имя и схему объекта.', 'Check the object name and schema.'),
    highlight: none,
  }),

  '42P16': (err, ctx) =>
    /multiple primary keys/i.test(err.message)
      ? {
          title: tr(ctx, 'Первичный ключ уже есть', 'Primary key already exists'),
          body: tr(
            ctx,
            'У таблицы может быть один первичный ключ, который при необходимости включает несколько колонок.',
            'A table can have one primary key, which may include multiple columns.',
          ),
          suggestion: tr(
            ctx,
            'Измени существующий первичный ключ или используй UNIQUE для другого набора колонок.',
            'Change the existing primary key or use UNIQUE for another set of columns.',
          ),
          highlight: none,
        }
      : {
          title: tr(ctx, 'Недопустимое определение таблицы', 'Invalid table definition'),
          body: tr(
            ctx,
            'Postgres не может создать или изменить таблицу с таким определением.',
            'Postgres cannot create or change the table with this definition.',
          ),
          suggestion: tr(
            ctx,
            'Проверь ограничения и настройки таблицы в тексте ошибки Postgres.',
            'Check the constraints and table settings in the Postgres error message.',
          ),
          highlight: none,
        },

  '42710': (_err, ctx) => ({
    title: tr(ctx, 'Объект уже существует', 'Object already exists'),
    body: tr(
      ctx,
      'Объект с таким именем уже создан в этой области, например ограничение таблицы.',
      'An object with this name already exists here, such as a table constraint.',
    ),
    suggestion: tr(
      ctx,
      'Выбери другое имя или измени существующий объект.',
      'Choose another name or change the existing object.',
    ),
    highlight: none,
  }),

  '22003': (_err, ctx) => ({
    title: tr(ctx, 'Число вне допустимого диапазона', 'Number out of range'),
    body: tr(
      ctx,
      'Результат или значение не помещается в выбранный числовой тип.',
      'The result or value does not fit the selected numeric type.',
    ),
    suggestion: tr(
      ctx,
      'Подбери значение в пределах диапазона или выбери тип с большим диапазоном и точностью.',
      'Use a value within the range or choose a type with a larger range and precision.',
    ),
    highlight: none,
  }),

  '22001': (_err, ctx) => ({
    title: tr(ctx, 'Строка слишком длинная', 'String is too long'),
    body: tr(
      ctx,
      'Значение длиннее ограничения типа колонки.',
      'The value exceeds the column type’s length limit.',
    ),
    suggestion: tr(
      ctx,
      'Сократи строку или увеличь допустимую длину колонки.',
      'Shorten the string or increase the column’s length limit.',
    ),
    highlight: none,
  }),

  [SANDBOX_TIMEOUT]: (_err, ctx) => ({
    title: tr(ctx, 'Запрос выполнялся дольше 3 секунд', 'Query took longer than 3 seconds'),
    body: tr(
      ctx,
      'Postgres в браузере не умеет сам прерывать долгие запросы, поэтому песочница ждёт 3 секунды, а потом останавливает запрос и перезапускается. Применённые изменения восстановлены.',
      'Postgres in the browser cannot interrupt long queries itself. The sandbox stops the query after 3 seconds and restarts. Applied changes have been restored.',
    ),
    suggestion: tr(
      ctx,
      'Проверь, нет ли лишнего декартова произведения или бесконечной рекурсии.',
      'Check for an unintended Cartesian product or infinite recursion.',
    ),
    highlight: none,
  }),

  [SANDBOX_CRASHED]: (_err, ctx) => ({
    title: tr(ctx, 'Песочница упала', 'Sandbox crashed'),
    body: tr(
      ctx,
      'Postgres в браузере перезапущен, твои изменения восстановлены.',
      'Postgres in the browser restarted, and your changes were restored.',
    ),
    highlight: none,
  }),
};
