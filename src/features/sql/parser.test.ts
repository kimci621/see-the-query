import { beforeAll, describe, expect, it } from 'vitest';
import { initParser, parseSql } from './parser';

const CYR_SQL = "select 'Привет' as x, b.title from book b";

// Сужение ParseOutcome до успешного исхода, чтобы не повторять if в каждом тесте
function ok(text: string) {
  const parsed = parseSql(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements;
}

beforeAll(async () => {
  await initParser();
});

describe('parseSql', () => {
  it('инвариант: текст оператора восстанавливается из диапазона', () => {
    const text = 'select 1; -- комментарий\nselect 2;';
    expect(ok(text).map((s) => s.text)).toEqual(['select 1', 'select 2']);
    for (const s of ok(text)) {
      expect(text.slice(s.from, s.to)).toBe(s.text);
      expect(s.text.endsWith(';')).toBe(false);
    }
    expect(ok(text)[1].from).toBeGreaterThan(ok(text)[0].to);
  });

  it('последний оператор без ; тянется до конца текста', () => {
    const text = 'select 1; select 2';
    expect(ok(text).map((s) => s.text)).toEqual(['select 1', 'select 2']);
    expect(ok(text)[1].to).toBe(text.length);
  });

  it('позиции символьные: кириллица перед вторым оператором сдвигает from', () => {
    const text = "select 'б'; select 2;";
    const second = ok(text)[1];
    // 'select 'б'; ' - 13 байтов и 12 символов: байтовая позиция 13, символьная 12
    expect(second.from).toBe(text.indexOf('select 2'));
    expect(second.from).toBe(12);
  });

  it('первый оператор: stmt_location опускается при 0, from равен 0', () => {
    expect(ok(CYR_SQL)).toHaveLength(1);
    expect(ok(CYR_SQL)[0].from).toBe(0);
    expect(ok(CYR_SQL)[0].kind).toBe('select');
  });

  it('пустой текст и одни комментарии: операторов нет', () => {
    expect(ok('')).toHaveLength(0);
    expect(ok('-- только комментарий\n')).toHaveLength(0);
  });

  it('невалидный текст: ошибка со символьной позицией', () => {
    const parsed = parseSql("select 'Привет' as x, from book");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // ошибка на from: байтовая позиция больше символьной из-за кириллицы
    expect(parsed.error.position).toBeGreaterThan(20);
    expect(typeof parsed.error.message).toBe('string');
  });

  it('kind: insert / update / delete / ddl / tcl', () => {
    const kinds = [
      ["insert into book (title) values ('x')", 'insert'],
      ['update book set title = 1', 'update'],
      ['delete from book', 'delete'],
      ['create table t (id int)', 'ddl'],
      ['drop table t', 'ddl'],
      ['alter table t add column c int', 'ddl'],
      ['begin', 'tcl'],
      ['commit', 'tcl'],
    ] as const;
    for (const [sql, kind] of kinds) {
      expect(ok(sql)[0].kind, sql).toBe(kind);
    }
  });
});

describe('deparse', () => {
  it('parse -> deparse -> parse проходит', async () => {
    const { deparse } = await import('./deparse');
    const parsed = parseSql('select b.title from book b where price > 500');
    if (!parsed.ok) throw new Error(parsed.error.message);
    const again = parseSql(deparse(parsed.statements[0].ast));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.statements).toHaveLength(1);
    expect(again.statements[0].kind).toBe('select');
  });
});
