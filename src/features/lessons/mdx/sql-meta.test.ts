import { describe, expect, it } from 'vitest';
import { parseSqlMeta } from './sql-meta';

describe('parseSqlMeta', () => {
  it('пустая мета: всё выключено', () => {
    expect(parseSqlMeta('')).toEqual({ run: false, apply: false, noexec: false });
  });

  it('run, ожидание строк и режим трассы', () => {
    expect(parseSqlMeta('run expect=rows:9 trace=final-only')).toEqual({
      run: true,
      apply: false,
      noexec: false,
      expectRows: 9,
      trace: 'final-only',
    });
  });

  it('rows:0 сохраняется', () => {
    expect(parseSqlMeta('run expect=rows:0').expectRows).toBe(0);
  });

  it('expectError и лишние пробелы', () => {
    expect(parseSqlMeta('  run   expectError=42703 ')).toMatchObject({ run: true, expectError: '42703' });
  });

  it('apply и noexec', () => {
    expect(parseSqlMeta('apply expect=rows:1')).toMatchObject({ apply: true, expectRows: 1 });
    expect(parseSqlMeta('noexec')).toMatchObject({ noexec: true, run: false });
  });

  it('опечатка бросает ошибку', () => {
    expect(() => parseSqlMeta('run expect=row:9')).toThrow('expect=row:9');
    expect(() => parseSqlMeta('expectError=4270')).toThrow('expectError=4270');
    expect(() => parseSqlMeta('trace=fast')).toThrow('trace=fast');
    expect(() => parseSqlMeta('run=yes')).toThrow('run=yes');
  });

  it('противоречивая мета бросает ошибку', () => {
    expect(() => parseSqlMeta('expect=rows:1 expectError=42703')).toThrow('expect и expectError');
    expect(() => parseSqlMeta('noexec run')).toThrow('noexec');
  });
});
