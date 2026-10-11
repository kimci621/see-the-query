import { beforeAll, describe, expect, it } from 'vitest';
import { clauseAt, clauseRanges } from './clauses';
import { initParser, parseSql } from './parser';
import type { ParsedStatement } from './types';

function stmtOf(text: string): ParsedStatement {
  const parsed = parseSql(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements[0];
}

function rangeOf(text: string, clause: string): { from: number; to: number } {
  const stmt = stmtOf(text);
  const found = clauseRanges(stmt).find((r) => r.clause === clause);
  if (!found) throw new Error(`нет клауза ${clause}`);
  return { from: found.from, to: found.to };
}

beforeAll(async () => {
  await initParser();
});

describe('clauseRanges', () => {
  it('select / from / where / order / limit, тексты совпадают со срезами', () => {
    const text = 'select b.title from book b where price > 500 order by title limit 3';
    expect(text.slice(...pair(rangeOf(text, 'select')))).toBe('b.title');
    expect(text.slice(...pair(rangeOf(text, 'from')))).toBe('book b');
    expect(text.slice(...pair(rangeOf(text, 'where')))).toBe('price > 500');
    expect(text.slice(...pair(rangeOf(text, 'order')))).toBe('title');
    expect(text.slice(...pair(rangeOf(text, 'limit')))).toBe('3');
  });

  it('group / having / offset и диапазоны отсортированы', () => {
    const text = 'select a, count(*) from t group by a having count(*) > 1 offset 2';
    expect(text.slice(...pair(rangeOf(text, 'group')))).toBe('a');
    expect(text.slice(...pair(rangeOf(text, 'having')))).toBe('count(*) > 1');
    expect(text.slice(...pair(rangeOf(text, 'offset')))).toBe('2');
    const ranges = clauseRanges(stmtOf(text));
    expect([...ranges].sort((a, b) => a.from - b.from)).toEqual(ranges);
  });

  it('кириллица перед WHERE: диапазон в символьных координатах (тест из плана Ф5)', () => {
    const text = 'select * from book as "Книга" where price > 500';
    const where = rangeOf(text, 'where');
    expect(text.slice(where.from, where.to)).toBe('price > 500');
    // где начинается 'price': алиас с кириллицей занимает 2 байта на символ, байтовые позиции съехали бы
    expect(where.from).toBe(text.indexOf('price'));
  });

  it('with / window', () => {
    const text =
      'with t as (select 1) select name, row_number() over (partition by city) from t window w as ()';
    const ranges = clauseRanges(stmtOf(text));
    expect(ranges.map((r) => r.clause)).toContain('with');
    expect(ranges.map((r) => r.clause)).toContain('select');
  });

  it('два оператора: диапазоны второго абсолютны в полном тексте', () => {
    const text = 'select 1; select a from book where a > 0';
    const parsed = parseSql(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const where = clauseRanges(parsed.statements[1]).find((r) => r.clause === 'where');
    expect(text.slice(where?.from, where?.to)).toBe('a > 0');
  });

  it('DML: into / values / set / where / returning / on_conflict / using', () => {
    const insert = "insert into book (title) values ('x') on conflict (title) do nothing returning book_id";
    expect(clauseRanges(stmtOf(insert)).map((r) => r.clause)).toEqual([
      'into',
      'values',
      'on_conflict',
      'returning',
    ]);
    const update = 'update book set title = 1 where book_id = 1 returning book_id';
    expect(clauseRanges(stmtOf(update)).map((r) => r.clause)).toEqual(['set', 'where', 'returning']);
    const del = 'delete from book using author where book.author_id = author.author_id';
    expect(clauseRanges(stmtOf(del)).map((r) => r.clause)).toEqual(['from', 'using', 'where']);
  });

  it('нет клаузов - пустой список', () => {
    expect(clauseRanges(stmtOf('begin'))).toEqual([]);
  });
});

describe('clauseAt', () => {
  it('курсор внутри клауза', () => {
    const stmt = stmtOf('select b.title from book b where price > 500');
    expect(clauseAt(stmt, 7)).toBe('select');
    expect(clauseAt(stmt, 22)).toBe('from');
    expect(clauseAt(stmt, 36)).toBe('where');
  });

  it('курсор между клаузами и в хвосте: null', () => {
    const stmt = stmtOf('select 1 from t');
    expect(clauseAt(stmt, 9)).toBeNull(); // на 'from'
    expect(clauseAt(stmt, 100)).toBeNull();
    expect(clauseAt(stmt, -1)).toBeNull();
  });
});

function pair(r: { from: number; to: number }): [number, number] {
  return [r.from, r.to];
}
