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
