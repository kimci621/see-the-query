import { beforeAll, describe, expect, it } from 'vitest';
import { introspect, type SchemaSnapshot } from '@/features/db/introspect';
import { type DbError, type DbException, SANDBOX_TIMEOUT } from '@/features/db/types';
import { initParser } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { explainError } from './explain';

let schema: SchemaSnapshot;
const errors = new Map<string, DbError>();

// Все ошибки настоящие: SQL выполняется в PGlite на bookstore
const CASES: Record<string, string> = {
  undefinedTable: 'select * from books',
  undefinedColumn: 'select nme from author',
  noFrom: 'select title, pr',
  subqueryColumn: 'select nme from (select 1 as x) t',
  outerDerivedMissingColumn:
    'select * from (select category_id, avg(price) as avg_price from book group by category_id) s where price > 500',
  doubleQuoted: 'select * from author where name = "Жюль Верн"',
  ambiguous: 'select name from author join customer on true',
  ambiguousAliased: 'select author_id from book b join author as a on b.author_id = a.author_id',
  ambiguousComment: '-- book list\nselect author_id from book join author on true',
  ambiguousCte: 'with author as (select * from author) select author_id from book join author on true',
  aliasedTable: 'select book.title from book b join author a on a.author_id = b.author_id',
  missingFrom: 'select x.title from book',
  missingFromKnown: 'select book.title from author',
  missingFromAliased: 'select b.title from book b join author a on a.author_id = c.author_id',
  ambiguousSelfJoin: 'select title from book b1 join book b2 on b1.book_id = b2.book_id',
  ambiguousSelfJoinBare: 'select author_id from book b join book on true',
  groupingSubquery:
    'select title, max(price) from book where author_id in (select author_id from book group by author_id)',
  groupingCte: 'with g as (select author_id from book group by author_id) select title, count(*) from book',
  groupingComment: '-- group by author_id\nselect title, count(*) from book',
  groupingInSubquery:
    'select title from book where author_id in (select author_id, title from book group by author_id)',
  aliasedSpecial: 'with "a(b" as (select 1 as x) select "a(b".x from "a(b" t',
  grouping: 'select author_id, title from book group by author_id',
  groupingNoGroupBy: 'select title, max(price) from book',
  aggregateInWhere: 'select title from book where price = max(price)',
  nestedAggregate: 'select max(count(*)) from book',
  groupingArgument: 'select grouping(price) from book group by rollup(category_id)',
  groupingQualifiedArgument: 'select grouping(b.price) from book b group by rollup(b.category_id)',
  groupingExpressionArgument: 'select grouping(price + 1) from book group by rollup(category_id)',
  groupingInWhere:
    'select category_id, count(*) from book where grouping(category_id) = 0 group by rollup(category_id)',
  groupingInJoin:
    'select * from book join book b on grouping(book.category_id) = 0 group by rollup(book.category_id)',
  groupingInGroupBy: 'select category_id from book group by grouping(category_id)',
  rangeOffset:
    'select sum(price) over (order by category_id, author_id range between 1 preceding and current row) from book',
  rangeOffsetZero: 'select sum(price) over (range between 1 preceding and current row) from book',
  unionThree: 'select 1 as x union select 2 as x union select 3 as x, 4 as y',
  formTypo: 'select title form book',
  commaBeforeFrom: 'select title, from book',
  unionColumns:
    "select name from author where country = 'Россия' union select name, country from author where country = 'Франция'",
  doubleEquals: 'select title from book where price == 350',
  whereNotBool: 'select title from book where price',
  exists: 'create table author (id int)',
  unique: `insert into customer (name, email, created_at) values ('X', 'anna@example.com', now())`,
  uniqueIndex: 'create unique index duplicate_idx on duplicate_values (id)',
  fkInsert: `insert into book (title, author_id) values ('X', 999)`,
  fkDelete: 'delete from author where author_id = 1',
  notNull: 'insert into author (name) values (null)',
  check: 'update customer set bonus = -1',
  missingPartition: 'insert into partitioned_values values (1)',
  divZero: 'select price / 0 from book',
  badInput: `select 'abc'::int`,
  subquery: 'select (select title from book) as t',
  identityInsert: `insert into author (author_id, name) values (1, 'X')`,
  identityUpdate: 'update author set author_id = 100 where author_id = 1',
  dependentDrop: 'drop table author',
  referencedTruncate: 'truncate author',
  restrictDelete: 'delete from restrict_parent where id = 1',
  invalidConflict: "insert into author (name) values ('X') on conflict (name) do nothing",
  nonuniqueReference: 'create table bad_fk (x text references author(name))',
  missingSchema: 'create table missing_schema.new_table (id int)',
  duplicateSchema: 'create schema public',
  wrongObject: 'drop view author',
  unusedSequence: "select currval('unused_seq')",
  duplicateColumn: 'alter table author add column name text',
  missingConstraint: 'alter table author drop constraint missing_constraint',
  multiplePrimary: 'alter table author add primary key (name)',
  duplicateConstraint: 'alter table customer add constraint customer_bonus_check check (bonus >= 0)',
  numericOverflow: 'select 1000::numeric(3, 0)',
  stringOverflow: "insert into short_text values ('abcd')",
  setNotNull: 'alter table book alter column price set not null',
  generatedInsert: 'insert into generated_values (a, b) values (1, 2)',
  generatedUpdate: 'update generated_values set b = 1',
  upsertTwice: 'insert into unique_values values (1), (1) on conflict (id) do update set id = excluded.id',
  mergeTwice:
    'merge into unique_values t using (values (1), (1)) s(id) on t.id = s.id when matched then update set id = s.id',
};

beforeAll(async () => {
  await initParser();
  await withDataset('bookstore', async (db) => {
    schema = await introspect(db);
    await db.exec(`
      create temp table restrict_parent (id int primary key);
      create temp table restrict_child (id int references restrict_parent(id) on delete restrict);
      insert into restrict_parent values (1);
      insert into restrict_child values (1);
      create temp sequence unused_seq;
      create temp table short_text (value varchar(2));
      create temp table generated_values (a int, b int generated always as (a * 2) stored);
      create temp table partitioned_values (id int) partition by range (id);
      create temp table partitioned_ten partition of partitioned_values for values from (10) to (20);
      create temp table duplicate_values (id int);
      insert into duplicate_values values (1), (1);
      create temp table unique_values (id int primary key);
      insert into unique_values values (1);
    `);
    for (const [name, sql] of Object.entries(CASES)) {
      await inPreview(db, () =>
        db.query(sql).then(
          () => errors.set(name, { code: 'none', message: 'ok' }),
          (e: DbException) => void errors.set(name, e.db),
        ),
      );
    }
  });
}, 20000);

const explain = (name: string) => explainError(errors.get(name) as DbError, { sql: CASES[name], schema });

describe('explainError', () => {
  it.each([
    ['undefinedTable', /table/i],
    ['undefinedColumn', /column/i],
    ['unique', /unique|already/i],
  ])('%s: английское объяснение сохраняет подсветку и исправление', (name, title) => {
    const error = errors.get(name) as DbError;
    const context = { sql: CASES[name], schema };
    const russian = explainError(error, context);
    const english = explainError(error, { ...context, locale: 'en' });
    expect(english.title).toMatch(title);
    expect(`${english.title} ${english.body} ${english.suggestion ?? ''}`).not.toMatch(/[А-Яа-яЁё]/);
    expect(english.highlight).toEqual(russian.highlight);
    expect(english.fix).toEqual(russian.fix);
  });

  it('для неизвестного кода сохраняет исходный текст Postgres', () => {
    const error = { code: 'XX999', message: 'original database error', hint: 'original hint' };
    expect(explainError(error, { sql: '', schema: null, locale: 'en' })).toMatchObject({
      title: 'Postgres rejected the query',
      body: error.message,
      suggestion: error.hint,
    });
  });

  it.each(Object.keys(CASES).filter((name) => name !== 'doubleQuoted'))(
    '%s: объяснение полностью на английском без изменения действий',
    (name) => {
      const error = errors.get(name) as DbError;
      const context = { sql: CASES[name], schema };
      const russian = explainError(error, context);
      const english = explainError(error, { ...context, locale: 'en' });
      expect(`${english.title} ${english.body} ${english.suggestion ?? ''}`).not.toMatch(/[А-Яа-яЁё]/);
      expect(english.highlight).toEqual(russian.highlight);
      expect(english.fix).toEqual(russian.fix);
    },
  );

  it('покрывает 32 SQLSTATE настоящими ошибками', () => {
    expect([...new Set([...errors.values()].map((e) => e.code))].sort()).toEqual([
      '0A000',
      '21000',
      '22001',
      '22003',
      '22012',
      '22P02',
      '23001',
      '23502',
      '23503',
      '23505',
      '23514',
      '2BP01',
      '3F000',
      '42601',
      '42701',
      '42702',
      '42703',
      '42704',
      '42710',
      '42803',
      '42804',
      '42809',
      '42830',
      '42883',
      '428C9',
      '42P01',
      '42P06',
      '42P07',
      '42P10',
      '42P16',
      '42P20',
      '55000',
    ]);
  });

  it.each([
    ['dependentDrop', '2BP01', 'зависят'],
    ['referencedTruncate', '0A000', 'TRUNCATE'],
    ['restrictDelete', '23001', 'RESTRICT'],
    ['invalidConflict', '42P10', 'уникальн'],
    ['nonuniqueReference', '42830', 'уникальн'],
    ['missingSchema', '3F000', 'missing_schema'],
    ['duplicateSchema', '42P06', 'public'],
    ['wrongObject', '42809', 'другого типа'],
    ['unusedSequence', '55000', 'currval'],
    ['duplicateColumn', '42701', 'name'],
    ['missingConstraint', '42704', 'не нашёл'],
    ['multiplePrimary', '42P16', 'первичный ключ'],
    ['duplicateConstraint', '42710', 'уже создан'],
    ['numericOverflow', '22003', 'числовой тип'],
    ['stringOverflow', '22001', 'длиннее'],
  ])('%s: реальный код %s получает своё объяснение', (name, code, expected) => {
    expect(errors.get(name)?.code).toBe(code);
    const explanation = explain(name);
    expect(explanation.title).not.toBe('Postgres отклонил запрос');
    expect(explanation.body).not.toBe(errors.get(name)?.message);
    expect(explanation.body).not.toMatch(/undefined/);
    expect(explanation.body).toContain(expected);
  });

  it('общие коды не выдают ошибки другого вида за TRUNCATE, currval, ON CONFLICT или первичный ключ', () => {
    const context = { sql: '', schema: null };
    for (const [code, message, forbidden] of [
      ['0A000', 'feature not supported', 'TRUNCATE'],
      ['55000', 'object is not in prerequisite state', 'currval'],
      ['42P10', 'invalid column reference', 'ON CONFLICT'],
      ['42P16', 'invalid table definition', 'первичный ключ'],
    ]) {
      const explanation = explainError({ code, message }, context);
      expect(`${explanation.title} ${explanation.body}`).not.toContain(forbidden);
    }
  });

  it('отличает отсутствие секции от нарушения CHECK с тем же кодом', () => {
    expect(errors.get('missingPartition')?.code).toBe('23514');
    expect(explain('missingPartition').title).toMatch(/секции/i);
    expect(explain('missingPartition').body).toContain('partitioned_values');
    expect(explain('missingPartition').body).not.toContain('undefined');
    expect(explain('missingPartition').suggestion).toMatch(/ключа|секци/i);
    expect(explain('check').title).toBe('Нарушено условие CHECK');
  });

  it('объясняет повторы при создании уникального индекса', () => {
    expect(errors.get('uniqueIndex')?.code).toBe('23505');
    expect(explain('uniqueIndex').body).toMatch(/индекс/i);
    expect(explain('uniqueIndex').suggestion).toMatch(/повтор/i);
    expect(explain('uniqueIndex').suggestion).not.toContain('INSERT');
    expect(explain('unique').suggestion).toContain('ON CONFLICT');
  });

  it('различает повторное изменение строки и скалярный подзапрос', () => {
    expect(errors.get('upsertTwice')?.code).toBe('21000');
    expect(errors.get('mergeTwice')?.code).toBe('21000');
    expect(explain('upsertTwice').body).toMatch(/одну и ту же строку/);
    expect(explain('mergeTwice').body).toMatch(/одну и ту же строку/);
    expect(explain('upsertTwice').suggestion).toContain('ON CONFLICT');
    expect(explain('mergeTwice').suggestion).toContain('источника');
    expect(explain('subquery').body).toMatch(/Подзапрос/);
  });

  it('SET NOT NULL сообщает о существующих строках с NULL', () => {
    expect(errors.get('setNotNull')?.code).toBe('23502');
    expect(explain('setNotNull').body).toMatch(/существующ/);
    expect(explain('setNotNull').suggestion).toMatch(/NULL/);
    expect(explain('setNotNull').body).not.toContain('undefined');
  });

  it('ошибки вычисляемых колонок отличаются от identity', () => {
    expect(errors.get('generatedInsert')?.code).toBe('428C9');
    expect(errors.get('generatedUpdate')?.code).toBe('428C9');
    expect(explain('generatedInsert').body).toMatch(/вычисляемая/);
    expect(explain('generatedUpdate').body).toMatch(/вычисляемая/);
    expect(explain('identityInsert').suggestion).toContain('OVERRIDING SYSTEM VALUE');
  });

  it('42P01: предлагает ближайшую таблицу', () => {
    expect(explain('undefinedTable')).toMatchObject({
      title: 'Таблицы books нет',
      suggestion: 'Может, book?',
    });
  });

  it('42703: ближайшая колонка и двойные кавычки', () => {
    expect(explain('undefinedColumn')).toMatchObject({
      suggestion: 'Может, name?',
      highlight: { tableIds: ['public.author'] },
    });
    expect(explain('doubleQuoted').suggestion).toBe(`Строку пишут в одинарных кавычках: 'Жюль Верн'.`);
  });

  it('42703 без FROM: объясняет отсутствующий FROM и называет таблицу с колонкой (P8.15)', () => {
    expect(explain('noFrom')).toMatchObject({
      title: 'Запрос без FROM',
      body: 'Колонку title Postgres ищет в таблицах из FROM, а FROM в запросе нет.',
      suggestion: 'title есть в book: допиши from book.',
      highlight: { tableIds: ['public.book'], columns: ['public.book.title'] },
    });
  });

  it('42703: текст карточки не повторяет заголовок (P8.15)', () => {
    expect(explain('undefinedColumn')).toMatchObject({
      title: 'Колонки nme нет',
      body: 'Postgres искал её в author.',
    });
    expect(explain('subqueryColumn')).toMatchObject({
      title: 'Колонки nme нет',
      body: 'Снаружи от подзапроса видна таблица t: в ней x. Колонки nme там нет.',
    });
    expect(explain('outerDerivedMissingColumn')).toMatchObject({
      title: 'Колонки price нет',
      body: 'Снаружи от подзапроса видна таблица s: в ней category_id, avg_price. Колонки price там нет.',
      suggestion: 'Добавь price в SELECT подзапроса или исправь имя.',
      highlight: { tableIds: [], columns: [] },
    });
    expect(explain('doubleQuoted').body).toBe('В двойных кавычках Postgres видит имя колонки, а не строку.');
  });

  it('fix: только когда словарь нашёл ближайшее имя', () => {
    expect(explain('undefinedTable').fix).toEqual({ from: 'books', to: 'book' });
    // колонки titel нет, title есть в book
    const typo: DbError = { code: '42703', message: 'column "titel" does not exist', position: 8 };
    expect(explainError(typo, { sql: 'select titel from book', schema }).fix).toEqual({
      from: 'titel',
      to: 'title',
    });
    const far: DbError = { code: '42703', message: 'column "zzzzzz" does not exist', position: 8 };
    expect(explainError(far, { sql: 'select zzzzzz from book', schema }).fix).toBeUndefined();
    expect(explain('doubleQuoted').fix).toBeUndefined();
  });

  it('42702: подсвечивает колонку в обеих таблицах', () => {
    expect(explain('ambiguous')).toMatchObject({
      suggestion: 'Укажи таблицу: author.name или customer.name.',
      highlight: {
        tableIds: ['public.author', 'public.customer'],
        columns: ['public.author.name', 'public.customer.name'],
      },
    });
  });

  it('42702: при алиасах подсказка через алиасы', () => {
    expect(explain('ambiguousAliased').suggestion).toBe('Укажи таблицу: a.author_id или b.author_id.');
  });

  it('42702: алиас берётся из разбора, а не из комментария или CTE', () => {
    expect(explain('ambiguousComment').suggestion).toBe(
      'Укажи таблицу: author.author_id или book.author_id.',
    );
    expect(explain('ambiguousCte').suggestion).toBe('Укажи таблицу: author.author_id или book.author_id.');
  });

  it('42P01: таблица под алиасом не называется «нет такой таблицы»', () => {
    expect(explain('aliasedTable')).toMatchObject({
      title: 'Таблица book здесь называется b',
      suggestion: 'Пиши b.title вместо book.title.',
      highlight: { tableIds: ['public.book'] },
    });
    expect(explain('aliasedTable').fix).toBeUndefined();
  });

  it('42P01: спецсимволы в имени таблицы не ломают разбор', () => {
    expect(explain('aliasedSpecial').title).toBe('Таблица a(b здесь называется t');
  });

  it('42803: колонка вне GROUP BY', () => {
    expect(explain('grouping').highlight.columns).toEqual(['public.book.title']);
    expect(explain('grouping').body).toMatch(/^После GROUP BY/);
    expect(explain('groupingNoGroupBy')).toMatchObject({
      title: 'Колонка вне GROUP BY',
      body: expect.stringMatching(/^Агрегат без GROUP BY сворачивает все строки в одну\. book\.title/),
      highlight: { columns: ['public.book.title'] },
    });
  });

  it('42P01 missing FROM-clause entry: не «таблицы нет», а нет в FROM', () => {
    expect(explain('missingFrom')).toMatchObject({
      title: 'x нет в FROM',
      body: 'Перед точкой стоит x, но в FROM нет ни таблицы, ни алиаса с таким именем. Колонки берутся только из таблиц FROM и JOIN.',
      suggestion: 'В FROM есть: book.',
      highlight: { tableIds: ['public.book'], columns: [] },
    });
    expect(explain('missingFrom').fix).toBeUndefined();
    expect(explain('missingFromKnown').suggestion).toBe(
      'Таблица book есть в базе: добавь её в FROM или JOIN.',
    );
    expect(explain('missingFromAliased').suggestion).toBe('В FROM есть: b, a.');
  });

  it('42702 self join: подсказка называет оба алиаса', () => {
    expect(explain('ambiguousSelfJoin')).toMatchObject({
      body: 'Колонка title есть и в b1, и в b2: это одна таблица book, взятая дважды. Postgres не угадывает, из какой копии её брать.',
      suggestion: 'Укажи таблицу: b1.title или b2.title.',
      highlight: { tableIds: ['public.book'], columns: ['public.book.title'] },
    });
    expect(explain('ambiguousSelfJoinBare').suggestion).toBe(
      'Укажи таблицу: b.author_id или book.author_id.',
    );
  });

  it('42803: GROUP BY смотрим у того SELECT, где стоит колонка, а не регэкспом по тексту', () => {
    for (const name of ['groupingSubquery', 'groupingCte', 'groupingComment']) {
      expect(explain(name).body, name).toMatch(/^Агрегат без GROUP BY/);
    }
    expect(explain('groupingInSubquery').body).toMatch(/^После GROUP BY/);
  });

  it('42803: GROUPING с выражением вне GROUP BY объясняет аргумент, а не «агрегат здесь нельзя»', () => {
    expect(errors.get('groupingArgument')?.code).toBe('42803');
    expect(explain('groupingArgument')).toMatchObject({
      title: 'GROUPING не видит выражение',
      body: 'Аргумент GROUPING: выражение «price». Его нет в GROUP BY.',
      suggestion: 'Добавь «price» в GROUP BY или убери из GROUPING.',
      highlight: { tableIds: [], columns: [] },
    });
  });

  it('42803: GROUPING с квалифицированной колонкой и выражением называет весь аргумент', () => {
    expect(explain('groupingQualifiedArgument')).toMatchObject({
      title: 'GROUPING не видит выражение',
      body: 'Аргумент GROUPING: выражение «b.price». Его нет в GROUP BY.',
      suggestion: 'Добавь «b.price» в GROUP BY или убери из GROUPING.',
    });
    expect(explain('groupingExpressionArgument')).toMatchObject({
      title: 'GROUPING не видит выражение',
      body: 'Аргумент GROUPING: выражение «price + 1». Его нет в GROUP BY.',
      suggestion: 'Добавь «price + 1» в GROUP BY или убери из GROUPING.',
    });
  });

  it('42803: GROUPING в WHERE, JOIN и GROUP BY не называют агрегатом', () => {
    expect(explain('groupingInWhere')).toMatchObject({
      title: 'GROUPING в WHERE',
      suggestion: 'Перенеси условие в HAVING.',
    });
    expect(explain('groupingInWhere').body).toMatch(/^GROUPING вычисляется/);
    expect(explain('groupingInJoin')).toMatchObject({
      title: 'GROUPING в JOIN',
      suggestion: 'Перенеси условие в HAVING.',
    });
    expect(explain('groupingInGroupBy')).toMatchObject({
      title: 'GROUPING в GROUP BY',
      suggestion: 'Используй GROUPING в SELECT, HAVING или ORDER BY.',
    });
  });

  it('42P20: RANGE со смещением объясняет причину при нуле и нескольких ключах ORDER BY', () => {
    expect(errors.get('rangeOffset')?.code).toBe('42P20');
    expect(explain('rangeOffset')).toMatchObject({
      title: 'RANGE со смещением',
      body: 'Смещение в RANGE считается по ключу сортировки, поэтому нужен ровно один ключ ORDER BY. Сейчас их ноль или несколько.',
      suggestion:
        'Добавь один ключ в ORDER BY окна или оставь только один; если нужны строки, используй ROWS.',
    });
    expect(explain('rangeOffsetZero')).toMatchObject({
      title: 'RANGE со смещением',
      body: 'Смещение в RANGE считается по ключу сортировки, поэтому нужен ровно один ключ ORDER BY. Сейчас их ноль или несколько.',
      suggestion:
        'Добавь один ключ в ORDER BY окна или оставь только один; если нужны строки, используй ROWS.',
    });
  });

  it('42803 без колонки в тексте: агрегат в WHERE и вложенный агрегат', () => {
    expect(errors.get('aggregateInWhere')?.code).toBe('42803');
    expect(explain('aggregateInWhere')).toMatchObject({
      title: 'Агрегат в WHERE',
      highlight: { columns: [] },
    });
    expect(errors.get('nestedAggregate')?.code).toBe('42803');
    expect(explain('nestedAggregate').title).toBe('Агрегат здесь нельзя');
    expect(explain('nestedAggregate').body).not.toContain('undefined');
  });

  it('42601 и 42883: частые опечатки', () => {
    expect(explain('formTypo').suggestion).toBe('Похоже на опечатку: FORM вместо FROM.');
    expect(explain('commaBeforeFrom').suggestion).toBe('Лишняя запятая перед FROM.');
    expect(explain('doubleEquals').suggestion).toBe('Сравнение пишется одним знаком: =.');
  });

  it('42601: разное число колонок в UNION не считается обрывом запроса', () => {
    expect(errors.get('unionColumns')?.code).toBe('42601');
    expect(explain('unionColumns')).toMatchObject({
      title: 'Разное число колонок',
      body: 'В ветвях UNION разное число колонок: слева 1, справа 2.',
      suggestion: 'Добавь или убери колонку, чтобы списки совпали.',
    });
    expect(explain('unionThree')).toMatchObject({
      title: 'Разное число колонок',
      body: 'В ветвях UNION разное число колонок: слева 1, справа 2.',
    });
  });

  it('ограничения подсвечивают свои колонки', () => {
    expect(explain('unique').highlight).toEqual({
      tableIds: ['public.customer'],
      columns: ['public.customer.email'],
    });
    expect(explain('fkInsert').highlight.columns).toEqual(['public.book.author_id']);
    expect(explain('fkDelete').title).toBe('На строку ещё ссылаются');
    expect(explain('notNull')).toMatchObject({
      title: 'name не может быть пустым',
      highlight: { columns: ['public.author.name'] },
    });
    expect(explain('check')).toMatchObject({
      body: 'Строка не прошла проверку customer_bonus_check: CHECK ((bonus >= 0)).',
      highlight: { columns: ['public.customer.bonus'] },
    });
  });

  it('428C9: в identity-колонку значение не пишут', () => {
    expect(explain('identityInsert')).toMatchObject({
      title: 'author_id заполняет сам Postgres',
      suggestion:
        'Убери author_id из INSERT, номер появится сам. Нужен именно свой номер: допиши OVERRIDING SYSTEM VALUE перед VALUES.',
      highlight: { tableIds: ['public.author'], columns: ['public.author.author_id'] },
    });
    expect(explain('identityUpdate').suggestion).toBe(
      'Убери author_id из SET: номер строки менять не нужно. Нужен новый номер из последовательности: SET author_id = DEFAULT.',
    );
    const generated: DbError = {
      code: '428C9',
      message: 'cannot insert a non-DEFAULT value into column "b"',
      detail: 'Column "b" is a generated column.',
    };
    expect(explainError(generated, { sql: 'insert into g (a, b) values (1, 2)', schema })).toMatchObject({
      title: 'b заполняет сам Postgres',
      suggestion: 'Убери b из запроса или передай DEFAULT.',
    });
  });

  it('у каждого кода есть заголовок и текст, неизвестный код показывает оригинал', () => {
    for (const name of Object.keys(CASES)) {
      const { title, body } = explain(name);
      expect(title, name).not.toMatch(/^Ошибка/);
      expect(body.replace(/\.$/, ''), name).not.toBe(title);
    }
    // один смысл с тостом сторожа (RESTART_MESSAGES.timeout) и спекой 5.4
    expect(explainError({ code: SANDBOX_TIMEOUT, message: '' }, { sql: '', schema: null })).toMatchObject({
      title: 'Запрос выполнялся дольше 3 секунд',
      body: expect.stringContaining('песочница ждёт 3 секунды'),
    });
    expect(
      explainError(
        { code: 'ZZ001', message: 'cannot drop table author', hint: 'Use DROP ... CASCADE' },
        { sql: '', schema: null },
      ),
    ).toEqual({
      title: 'Postgres отклонил запрос',
      body: 'cannot drop table author',
      suggestion: 'Use DROP ... CASCADE',
      highlight: { tableIds: [], columns: [] },
    });
  });
});
