import { describe, expect, it } from 'vitest';
import type { DbError } from '@/features/db/types';
import { applyFix, parseDiagnostic, pgDiagnostic } from './diagnostics';

describe('parseDiagnostic', () => {
  it('подчёркивает слово под позицией', () => {
    const d = parseDiagnostic('select from book', { message: 'syntax error', position: 7 });
    expect(d.from).toBe(7);
    expect(d.to).toBe(11);
    expect(d.message).toBe('syntax error');
  });

  it('кириллица и имя в двойных кавычках подчёркиваются целиком', () => {
    const quoted = parseDiagnostic('select "Тихий Дон" from book', { message: 'нет колонки', position: 7 });
    expect([quoted.from, quoted.to]).toEqual([7, 18]);
    const cyr = parseDiagnostic('select имя from book', { message: 'нет колонки', position: 7 });
    expect([cyr.from, cyr.to]).toEqual([7, 10]);
  });

  it('эмодзи перед ошибкой: позиция libpg-query в кодовых точках', () => {
    // 'book' на кодовой точке 16, в UTF-16 на 18: каждый эмодзи занимает два кода
    const d = parseDiagnostic("select '😀😀' frm book", { message: 'syntax error', position: 16 });
    expect([d.from, d.to]).toEqual([18, 22]);
  });

  it('позиция в конце текста подчёркивает один символ', () => {
    const d = parseDiagnostic('select 1', { message: 'ой', position: 8 });
    expect(d.from).toBe(7);
    expect(d.to).toBe(8);
  });
});

describe('pgDiagnostic', () => {
  const err = (position: number): DbError => ({
    code: '42703',
    message: 'column "nme" does not exist',
    position,
  });

  it('position 1-based от начала оператора переводится в абсолютную позицию', () => {
    const text = 'select 1; select nme from book';
    const d = pgDiagnostic(text, 'select nme from book', err(8));
    expect(d?.from).toBe(17); // начало 'nme'
    expect(d?.to).toBe(20);
    expect(text.slice(d?.from, d?.to)).toBe('nme');
  });

  it('позиция на операторе подчёркивает оператор, а не следующее слово', () => {
    const text = 'select title from book where price == 890';
    const d = pgDiagnostic(text, text, { code: '42883', message: 'operator does not exist', position: 36 });
    expect(text.slice(d?.from, d?.to)).toBe('==');
  });

  // Лексер Postgres: хвостовые + и - не входят в оператор без ~!@#^&|`?%, `::` - приведение типа
  it.each([
    ['select * from t where s=-1', '=-1', '='],
    ['select a =- s from t', '=- s', '='],
    ['select a <=- 1 from t', '<=-', '<='],
    ['select a !=- 1 from t', '!=-', '!=-'],
    ['select 1 @- 1', '@-', '@-'],
    ['select a+-1 from t', '+-1', '+'],
    ['select a::date from t', '::date', '::'],
    ['select a<>1 from t', '<>1', '<>'],
    ['select a=/* x */1 from t', '=/*', '='],
  ])('оператор в %s с позиции %s подчёркнут как %s', (text, at, expected) => {
    const position = text.indexOf(at) + 1;
    const d = pgDiagnostic(text, text, { code: '42883', message: 'x', position });
    expect(text.slice(d?.from, d?.to)).toBe(expected);
  });

  it('без position или без оператора в тексте: null', () => {
    expect(pgDiagnostic('select 1', 'select 1', { code: '23503', message: 'x' })).toBeNull();
    expect(pgDiagnostic('другое', 'select 1', err(1))).toBeNull();
  });
});

describe('applyFix', () => {
  const TITLE = { from: 'titel', to: 'title' };
  const err = (position?: number): DbError => ({
    code: '42703',
    message: 'column "titel" does not exist',
    position,
  });

  it('applyFix попадает в слово после кириллицы', () => {
    const text = "select 'Жюль' as a, titel from book";
    const position = text.indexOf('titel') + 1;
    expect(applyFix(text, text, err(position), TITLE)).toBe("select 'Жюль' as a, title from book");
  });

  it('оператор не первый: позиция считается от его начала', () => {
    const stmt = 'select titel from book';
    const text = `select 1; ${stmt}`;
    expect(applyFix(text, stmt, err(8), TITLE)).toBe('select 1; select title from book');
  });

  it('null, если позиции нет или она не на слове', () => {
    expect(applyFix('select titel from book', 'select titel from book', err(), TITLE)).toBeNull();
    expect(applyFix('', '', err(1), TITLE)).toBeNull();
    // позиция на пробеле
    expect(applyFix('select  titel', 'select  titel', err(7), TITLE)).toBeNull();
    // оператора нет в тексте
    expect(applyFix('другое', 'select titel', err(8), TITLE)).toBeNull();
  });

  it('эмодзи перед ошибкой: позиция по кодовым точкам, чужое слово не трогаем', () => {
    const text = "select '😀😀' as a,titel from book";
    // Postgres считает символы: каждый эмодзи это 1, в JS это 2
    const position = Array.from("select '😀😀' as a,").length + 1;
    expect(applyFix(text, text, err(position), TITLE)).toBe("select '😀😀' as a,title from book");
    // позиция, посчитанная по UTF-16, уезжает на другое слово: оно не равно fix.from
    expect(applyFix(text, text, err(text.indexOf('titel') + 1), TITLE)).toBeNull();
  });

  it('pgDiagnostic тоже считает позицию по кодовым точкам', () => {
    const text = "select '😀😀' as a,titel from book";
    const position = Array.from("select '😀😀' as a,").length + 1;
    const d = pgDiagnostic(text, text, { code: '42703', message: 'x', position });
    expect(text.slice(d?.from, d?.to)).toBe('titel');
  });

  it('слово без учёта регистра равно fix.from', () => {
    const text = 'select TITEL from book';
    expect(applyFix(text, text, err(8), TITLE)).toBe('select title from book');
  });

  it('null для квалифицированного имени: позиция на таблице, а не на колонке', () => {
    const text = 'select book.titel from book';
    expect(applyFix(text, text, err(8), TITLE)).toBeNull();
  });
});
