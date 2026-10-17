import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { type DbError, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from '@/features/db/types';

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
}
type Entry = (err: DbError, ctx: ErrorContext) => ErrorExplanation;

const none = { tableIds: [], columns: [] };

// Первое имя в кавычках из текста ошибки: relation "books" → books
const quoted = (message: string) => /"([^"]+)"/.exec(message)?.[1] ?? '';

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
    const names = ctx.schema?.tables.map((t) => t.name) ?? [];
    const guess = closest(name, names);
    return {
      title: `Таблицы ${name} нет`,
      body: names.length
        ? `Postgres не нашёл таблицу ${name}. Есть: ${names.join(', ')}.`
        : `Postgres не нашёл таблицу ${name}. В базе пока нет ни одной таблицы.`,
      suggestion: guess ? `Может, ${guess}?` : undefined,
      fix: guess ? { from: name, to: guess } : undefined,
      highlight: { tableIds: ctx.schema?.tables.map((t) => t.id) ?? [], columns: [] },
    };
  },

  '42703': (err, ctx) => {
    // column "nme" does not exist или column b.nme does not exist
    const raw = /column (?:"([^"]+)"|(\S+)) does not exist/.exec(err.message);
    const name = (raw?.[1] ?? raw?.[2] ?? '').replace(/^.*\./, '');
    const tables = tablesInSql(ctx);
    const guess = closest(
      name,
      tables.flatMap((t) => t.columns.map((c) => c.name)),
    );
    const asString = ctx.sql.includes(`"${name}"`);
    return {
      title: `Колонки ${name} нет`,
      body: asString
        ? `В двойных кавычках Postgres видит имя колонки, а не строку. Колонки «${name}» нет${tables.length ? ` в ${tables.map((t) => t.name).join(', ')}` : ''}.`
        : `Колонки ${name} нет${tables.length ? ` в ${tables.map((t) => t.name).join(', ')}` : ''}.`,
      suggestion: asString
        ? `Строку пишут в одинарных кавычках: '${name}'.`
        : guess
          ? `Может, ${guess}?`
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
    return {
      title: `Непонятно, какая ${name}`,
      body:
        owners.length > 1
          ? `Колонка ${name} есть и в ${owners.map((t) => t.name).join(', и в ')}. Postgres не угадывает, из какой таблицы её брать.`
          : `Колонка ${name} есть в нескольких таблицах запроса. Postgres не угадывает, из какой её брать.`,
      suggestion: owners.length
        ? `Укажи таблицу: ${owners.map((t) => `${t.name}.${name}`).join(' или ')}.`
        : 'Укажи таблицу или алиас перед именем колонки.',
      highlight: { tableIds: owners.map((t) => t.id), columns: owners.map((t) => `${t.id}.${name}`) },
    };
  },

  '42803': (err, ctx) => {
    // column "book.title" must appear in the GROUP BY clause ...
    const [table, column] = quoted(err.message).split('.');
    const owner = ctx.schema?.tables.find((t) => t.name === table);
    return {
      title: 'Колонка вне GROUP BY',
      body: `После GROUP BY от каждой группы остаётся одна строка. ${table}.${column} в группе может быть разным, и Postgres не знает, какое значение показать.`,
      suggestion: `Добавь ${table}.${column} в GROUP BY или оберни в агрегат, например max(${table}.${column}).`,
      highlight: { tableIds: owner ? [owner.id] : [], columns: owner ? [`${owner.id}.${column}`] : [] },
    };
  },

  '42601': (err, ctx) => {
    const near = quoted(err.message);
    const sql = ctx.sql;
    const suggestion = /\bform\b/i.test(sql)
      ? 'Похоже на опечатку: FORM вместо FROM.'
      : near.toLowerCase() === 'from' && /,\s*from\b/i.test(sql)
        ? 'Лишняя запятая перед FROM.'
        : /==/.test(sql)
          ? 'Сравнение в SQL пишется одним знаком: =.'
          : undefined;
    return {
      title: 'Синтаксическая ошибка',
      body: near
        ? `Postgres не понял запрос в месте «${near}». Обычно ошибка прямо перед этим словом.`
        : 'Запрос оборвался раньше, чем Postgres ожидал.',
      suggestion,
      highlight: none,
    };
  },

  '42883': (err) => {
    const op = err.message.includes('==');
    return {
      title: op ? 'Нет оператора ==' : 'Нет такой функции или оператора',
      body: op
        ? 'В SQL нет оператора ==.'
        : 'Postgres ищет функцию по имени и типам аргументов. С такими типами её нет.',
      suggestion: op
        ? 'Сравнение пишется одним знаком: =.'
        : 'Проверь имя и приведи аргумент к нужному типу, например pages::text.',
      highlight: none,
    };
  },

  '42804': (err) => ({
    title: 'Не тот тип',
    body: err.message.startsWith('argument of WHERE')
      ? 'WHERE ждёт условие, которое даёт true или false, а получил число или строку.'
      : 'Тип значения не подходит туда, куда его подставили.',
    suggestion: err.message.startsWith('argument of WHERE')
      ? 'Допиши сравнение: например, where price > 500.'
      : 'Приведи значение к нужному типу через ::тип.',
    highlight: none,
  }),

  '42P07': (err, ctx) => {
    const name = quoted(err.message);
    const t = ctx.schema?.tables.find((x) => x.name === name);
    return {
      title: `${name} уже есть`,
      body: `Объект с именем ${name} уже создан в этой схеме.`,
      suggestion: 'Выбери другое имя или напиши CREATE TABLE IF NOT EXISTS.',
      highlight: { tableIds: t ? [t.id] : [], columns: [] },
    };
  },

  '23505': (err) => {
    const key = parseKey(err.detail);
    return {
      title: 'Такое значение уже есть',
      body: key
        ? `Ограничение ${err.constraint} требует уникальности: (${key.values}) в ${key.columns.join(', ')} уже есть в ${err.table}.`
        : `Ограничение ${err.constraint} требует уникальности.`,
      suggestion: 'Возьми другое значение или используй INSERT ... ON CONFLICT.',
      highlight: { tableIds: [tableId(err)], columns: key?.columns.map((c) => columnId(err, c)) ?? [] },
    };
  },

  '23503': (err) => {
    const key = parseKey(err.detail);
    const referenced = /still referenced from table "([^"]+)"/.exec(err.detail ?? '')?.[1];
    return {
      title: referenced ? 'На строку ещё ссылаются' : 'Ссылка в никуда',
      body: referenced
        ? `Строку с (${key?.values}) нельзя удалить или изменить: на неё ссылается ${referenced} через ${err.constraint}.`
        : `Значения (${key?.values}) нет в таблице, на которую ссылается ${err.constraint}.`,
      suggestion: referenced
        ? `Сначала удали строки в ${referenced} или объяви внешний ключ с ON DELETE CASCADE.`
        : 'Сначала добавь строку в родительскую таблицу или поправь значение.',
      highlight: { tableIds: [tableId(err)], columns: key?.columns.map((c) => columnId(err, c)) ?? [] },
    };
  },

  '23502': (err) => ({
    title: `${err.column} не может быть пустым`,
    body: `У колонки ${err.column} в ${err.table} стоит NOT NULL, а строка пришла с NULL.`,
    suggestion: `Передай значение для ${err.column} или задай колонке DEFAULT.`,
    highlight: { tableIds: [tableId(err)], columns: [columnId(err, err.column ?? '')] },
  }),

  '23514': (err, ctx) => {
    // имя по умолчанию: <таблица>_<колонка>_check
    const column = err.constraint?.replace(`${err.table}_`, '').replace(/_check$/, '');
    const owner = ctx.schema?.tables.find((t) => t.id === tableId(err));
    const col = owner?.columns.find((c) => c.name === column);
    return {
      title: 'Нарушено условие CHECK',
      body: `Строка не прошла проверку ${err.constraint}${col?.checks.length ? `: ${col.checks.join(', ')}` : ''}.`,
      suggestion: 'Поправь значение так, чтобы условие выполнялось.',
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
      title: `${name} заполняет сам Postgres`,
      body: identity
        ? `Колонка ${name} объявлена как GENERATED ALWAYS AS IDENTITY: номер для неё выдаёт Postgres, а явное значение она отвергает всегда.`
        : `Колонка ${name} вычисляемая (GENERATED ALWAYS AS): Postgres считает её сам из других колонок.`,
      suggestion: !identity
        ? `Убери ${name} из запроса или передай DEFAULT.`
        : err.message.includes('updated')
          ? `Убери ${name} из SET: номер строки менять не нужно. Нужен новый номер из последовательности: SET ${name} = DEFAULT.`
          : `Убери ${name} из INSERT, номер появится сам. Нужен именно свой номер: допиши OVERRIDING SYSTEM VALUE перед VALUES.`,
      highlight: { tableIds: owners.map((t) => t.id), columns: owners.map((t) => `${t.id}.${name}`) },
    };
  },

  '22012': () => ({
    title: 'Деление на ноль',
    body: 'В одной из строк делитель равен нулю.',
    suggestion: 'Оберни делитель в nullif(x, 0): тогда результат будет NULL вместо ошибки.',
    highlight: none,
  }),

  '22P02': (err) => ({
    title: 'Значение не того формата',
    body: `Postgres не смог превратить ${quoted(err.message) || 'значение'} в нужный тип: ${err.message.replace(/^invalid input syntax for type (\S+).*$/, '$1')}.`,
    suggestion: 'Проверь кавычки и формат значения.',
    highlight: none,
  }),

  '21000': () => ({
    title: 'Подзапрос вернул больше одной строки',
    body: 'Подзапрос стоит на месте одного значения, а вернул несколько строк.',
    suggestion: 'Используй IN или EXISTS, добавь агрегат или условие, после которого останется одна строка.',
    highlight: none,
  }),

  [SANDBOX_TIMEOUT]: () => ({
    title: 'Запрос выполнялся слишком долго',
    body: 'Песочница прервала запрос через 3 секунды и перезапустилась. Твои применённые изменения восстановлены.',
    suggestion: 'Проверь, нет ли лишнего декартова произведения или бесконечной рекурсии.',
    highlight: none,
  }),

  [SANDBOX_CRASHED]: () => ({
    title: 'Песочница упала',
    body: 'Postgres в браузере перезапущен, твои изменения восстановлены.',
    highlight: none,
  }),
};
