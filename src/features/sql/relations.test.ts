import { beforeAll, describe, expect, it } from 'vitest';
import { initParser, parseSql } from './parser';
import { relationsOf } from './relations';

function stmtOf(text: string) {
  const parsed = parseSql(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements[0];
}

beforeAll(async () => {
  await initParser();
});

describe('relationsOf', () => {
  it('таблицы FROM с алиасами, диапазоны на имена таблиц', () => {
    const stmt = stmtOf('select * from book b join author a on b.author_id = a.author_id');
    const rel = relationsOf(stmt);
    expect(rel.tables.map((t) => [t.name, t.alias])).toEqual([
      ['book', 'b'],
      ['author', 'a'],
    ]);
    expect(rel.tables.every((t) => stmt.text.slice(t.from, t.to).startsWith(t.name))).toBe(true);
  });

  it('self join: обе ссылки на таблицу со своими алиасами', () => {
    const rel = relationsOf(stmtOf('select b2.title from book b1 join book b2 on b1.book_id = b2.book_id'));
    expect(rel.tables.map((t) => [t.name, t.alias])).toEqual([
      ['book', 'b1'],
      ['book', 'b2'],
    ]);
  });

  it('колонки с квалификатором и без, звёздочка тоже попадает', () => {
    const stmt = stmtOf('select b.title, price from book b');
    const rel = relationsOf(stmt);
    expect(rel.columns.map((c) => [c.qualifier, c.name])).toEqual([
      ['b', 'title'],
      [null, 'price'],
    ]);
  });

  it('колонки WHERE и подзапроса, кириллица до колонки сдвигает позицию', () => {
    const stmt = stmtOf("select 'Привет' as x, b.title from book b where b.price > 500");
    const rel = relationsOf(stmt);
    const title = rel.columns.find((c) => c.name === 'title');
    expect(title?.from).toBe(22); // 22 - символьная позиция b.title (байтовая 28)
    expect(stmt.text.slice(0, title?.from)).toBe("select 'Привет' as x, ");
    const price = rel.columns.find((c) => c.name === 'price');
    expect(price?.qualifier).toBe('b');
  });

  it('вторая таблица со схемой, колонки подзапроса тоже собираются', () => {
    const stmt = stmtOf('select name from shop.cart where book_id in (select book_id from book)');
    const rel = relationsOf(stmt);
    expect(rel.tables.map((t) => [t.schema, t.name])).toContainEqual(['shop', 'cart']);
    expect(rel.tables.map((t) => [t.schema, t.name])).toContainEqual([null, 'book']);
    expect(rel.columns.filter((c) => c.name === 'book_id')).toHaveLength(2);
  });

  it('DML: relation INSERT, таблица UPDATE, диапазоны абсолютные при двух операторах', () => {
    const text = 'select 1; select title from book';
    const parsed = parseSql(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const rel = relationsOf(parsed.statements[1]);
    const title = rel.columns[0];
    // позиция в полном тексте, не относительно оператора
    expect(text.slice(title.from, title.to)).toBe('title');
    const insert = stmtOf("insert into book (title) values ('x')");
    expect(relationsOf(insert).tables.map((t) => t.name)).toEqual(['book']);
  });
});
