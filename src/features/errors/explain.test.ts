import { beforeAll, describe, expect, it } from 'vitest';
import { introspect, type SchemaSnapshot } from '@/features/db/introspect';
import { type DbError, type DbException, SANDBOX_TIMEOUT } from '@/features/db/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { explainError } from './explain';

let schema: SchemaSnapshot;
const errors = new Map<string, DbError>();

// Все ошибки настоящие: SQL выполняется в PGlite на bookstore
const CASES: Record<string, string> = {
  undefinedTable: 'select * from books',
  undefinedColumn: 'select nme from author',
  doubleQuoted: 'select * from author where name = "Жюль Верн"',
  ambiguous: 'select name from author join customer on true',
  ambiguousAliased: 'select author_id from book b join author as a on b.author_id = a.author_id',
  aliasedTable: 'select book.title from book b join author a on a.author_id = b.author_id',
  grouping: 'select author_id, title from book group by author_id',
  formTypo: 'select title form book',
  commaBeforeFrom: 'select title, from book',
  doubleEquals: 'select title from book where price == 350',
  whereNotBool: 'select title from book where price',
  exists: 'create table author (id int)',
  unique: `insert into customer (name, email, created_at) values ('X', 'anna@example.com', now())`,
  fkInsert: `insert into book (title, author_id) values ('X', 999)`,
  fkDelete: 'delete from author where author_id = 1',
  notNull: 'insert into author (name) values (null)',
  check: 'update customer set bonus = -1',
  divZero: 'select price / 0 from book',
  badInput: `select 'abc'::int`,
  subquery: 'select (select title from book) as t',
  identityInsert: `insert into author (author_id, name) values (1, 'X')`,
  identityUpdate: 'update author set author_id = 100 where author_id = 1',
};

beforeAll(async () => {
  await withDataset('bookstore', async (db) => {
    schema = await introspect(db);
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
  it('покрывает 16 SQLSTATE настоящими ошибками', () => {
    expect([...new Set([...errors.values()].map((e) => e.code))].sort()).toEqual([
      '21000',
      '22012',
      '22P02',
      '23502',
      '23503',
      '23505',
      '23514',
      '42601',
      '42702',
      '42703',
      '42803',
      '42804',
      '42883',
      '428C9',
      '42P01',
      '42P07',
    ]);
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

  it('42P01: таблица под алиасом не называется «нет такой таблицы»', () => {
    expect(explain('aliasedTable')).toMatchObject({
      title: 'Таблица book здесь называется b',
      suggestion: 'Пиши b.title вместо book.title.',
      highlight: { tableIds: ['public.book'] },
    });
    expect(explain('aliasedTable').fix).toBeUndefined();
  });

  it('42803: колонка вне GROUP BY', () => {
    expect(explain('grouping').highlight.columns).toEqual(['public.book.title']);
  });

  it('42601 и 42883: частые опечатки', () => {
    expect(explain('formTypo').suggestion).toBe('Похоже на опечатку: FORM вместо FROM.');
    expect(explain('commaBeforeFrom').suggestion).toBe('Лишняя запятая перед FROM.');
    expect(explain('doubleEquals').suggestion).toBe('Сравнение пишется одним знаком: =.');
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
    for (const name of Object.keys(CASES)) expect(explain(name).title, name).not.toMatch(/^Ошибка/);
    expect(explainError({ code: SANDBOX_TIMEOUT, message: '' }, { sql: '', schema: null }).title).toBe(
      'Запрос выполнялся слишком долго',
    );
    expect(
      explainError(
        { code: '2BP01', message: 'cannot drop table author', hint: 'Use DROP ... CASCADE' },
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
