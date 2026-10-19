import { beforeAll, describe, expect, it } from 'vitest';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { initParser, parseSql } from '@/features/sql/parser';
import { relationsOf } from '@/features/sql/relations';
import { resolveColumn, touchedOf } from './touched';

function stmtOf(text: string) {
  const parsed = parseSql(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements[0];
}

const table = (id: string, names: string[], type = 'text'): TableInfo => {
  const [schema = 'public', name = id] = id.split('.');
  return {
    id,
    schema,
    name,
    kind: 'table',
    columns: names.map((n) => ({
      name: n,
      type,
      nullable: true,
      default: null,
      isPk: false,
      isUnique: false,
      isGenerated: false,
      identity: null,
      checks: [],
      fk: null,
    })),
    rowCount: 0,
    sampleRows: [],
    sampleCtids: [],
    indexes: [],
    comment: null,
  };
};

const SCHEMA: SchemaSnapshot = {
  schemas: ['public', 'shop'],
  tables: [
    table('public.book', ['book_id', 'title', 'price', 'author_id']),
    table('public.author', ['author_id', 'name']),
    table('shop.cart', ['cart_id']),
  ],
  fks: [],
  sequences: [],
};

beforeAll(async () => {
  await initParser();
});

describe('touchedOf', () => {
  it('таблицы и колонки резолвятся в идентификаторы доски', () => {
    const t = touchedOf(stmtOf('select b.title, b.price from book b'), SCHEMA);
    expect(t.tableIds).toEqual(['public.book']);
    expect(t.columns).toEqual(['public.book.title', 'public.book.price']);
  });

  it('колонка без квалификатора резолвится, если она ровно в одной таблице запроса', () => {
    const t = touchedOf(
      stmtOf('select title from book b join author a on b.author_id = a.author_id'),
      SCHEMA,
    );
    expect(t.tableIds).toEqual(['public.book', 'public.author']);
    // колонки условия ON резолвятся по алиасам, title - без квалификатора по единственной таблице
    expect(t.columns).toEqual(['public.book.title', 'public.book.author_id', 'public.author.author_id']);
  });

  it('неоднозначная колонка без квалификатора не попадает в touched', () => {
    // author_id есть и в book, и в author
    const t = touchedOf(stmtOf('select author_id from book b join author a using (author_id)'), SCHEMA);
    expect(t.columns).toEqual([]);
  });

  it('несуществующая таблица (CTE) пропускается без ошибки', () => {
    const t = touchedOf(stmtOf('with t as (select 1) select * from t'), SCHEMA);
    expect(t.tableIds).toEqual([]);
  });

  it('без схемы - пустой результат', () => {
    expect(touchedOf(stmtOf('select title from book'), null)).toEqual({
      tableIds: [],
      columns: [],
      expanded: [],
    });
  });

  it('звёздочка без квалификатора разворачивает таблицы оператора', () => {
    expect(touchedOf(stmtOf('select * from book'), SCHEMA).expanded).toEqual(['public.book']);
    expect(
      touchedOf(stmtOf('select * from book b join author a on b.author_id = a.author_id'), SCHEMA).expanded,
    ).toEqual(['public.book', 'public.author']);
  });

  it('звёздочка подсвечивает все поля своих таблиц', () => {
    const book = SCHEMA.tables.find((t) => t.id === 'public.book');
    const all = book?.columns.map((c) => `public.book.${c.name}`) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(touchedOf(stmtOf('select * from book'), SCHEMA).columns).toEqual(all);
    const joined = touchedOf(
      stmtOf('select b.*, a.name from book b join author a on b.author_id = a.author_id'),
      SCHEMA,
    );
    expect(joined.columns).toEqual([...all, 'public.author.name', 'public.author.author_id']);
  });

  it('t.* разворачивает только свою таблицу, по алиасу или имени', () => {
    const joined = 'from book b join author a on b.author_id = a.author_id';
    expect(touchedOf(stmtOf(`select b.* ${joined}`), SCHEMA).expanded).toEqual(['public.book']);
    expect(touchedOf(stmtOf('select author.* from author'), SCHEMA).expanded).toEqual(['public.author']);
  });

  it('имя таблицы с алиасом не квалифицирует звёздочку', () => {
    expect(touchedOf(stmtOf('select book.* from book b'), SCHEMA).expanded).toEqual([]);
  });

  it('без звёздочки и с count(*) ничего не разворачивается', () => {
    expect(touchedOf(stmtOf('select title from book'), SCHEMA).expanded).toEqual([]);
    expect(touchedOf(stmtOf('select count(*) from book'), SCHEMA).expanded).toEqual([]);
  });
});

describe('resolveColumn', () => {
  it('по алиасу, по имени таблицы, со схемой', () => {
    const bookTables = relationsOf(stmtOf('select b.title from book b')).tables;
    expect(resolveColumn({ qualifier: 'b', name: 'title', from: 0, to: 0 }, bookTables, SCHEMA)).toEqual({
      id: 'public.book.title',
      type: 'text',
    });
    expect(resolveColumn({ qualifier: 'book', name: 'price', from: 0, to: 0 }, bookTables, SCHEMA)).toEqual({
      id: 'public.book.price',
      type: 'text',
    });
    const cartTables = relationsOf(stmtOf('select cart_id from shop.cart')).tables;
    expect(resolveColumn({ qualifier: 'cart', name: 'cart_id', from: 0, to: 0 }, cartTables, SCHEMA)).toEqual(
      { id: 'shop.cart.cart_id', type: 'text' },
    );
    expect(resolveColumn({ qualifier: null, name: 'cart_id', from: 0, to: 0 }, cartTables, SCHEMA)).toEqual({
      id: 'shop.cart.cart_id',
      type: 'text',
    });
  });

  it('неизвестный квалификатор или колонка дают null', () => {
    const tables = relationsOf(stmtOf('select b.title from book b')).tables;
    expect(resolveColumn({ qualifier: 'zzz', name: 'title', from: 0, to: 0 }, tables, SCHEMA)).toBeNull();
    expect(resolveColumn({ qualifier: 'b', name: 'nope', from: 0, to: 0 }, tables, SCHEMA)).toBeNull();
    expect(resolveColumn({ qualifier: 'b', name: 'title', from: 0, to: 0 }, tables, null)).toBeNull();
  });
});
