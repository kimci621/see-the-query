import { describe, expect, it } from 'vitest';
import type { DbError } from '@/features/db/types';
import { parseDiagnostic, pgDiagnostic } from './diagnostics';

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
