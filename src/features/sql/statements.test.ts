import { beforeAll, describe, expect, it } from 'vitest';
import { initParser, parseSql } from './parser';
import { statementAt } from './statements';

const TEXT = 'select 1; -- комм\nselect 2; select 3';

function stmts() {
  const parsed = parseSql(TEXT);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements;
}

beforeAll(async () => {
  await initParser();
});

describe('statementAt', () => {
  it('курсор внутри оператора', () => {
    expect(statementAt(stmts(), 4)?.text).toBe('select 1');
    expect(statementAt(stmts(), 26)?.text).toBe('select 2');
    expect(statementAt(stmts(), TEXT.length - 1)?.text).toBe('select 3');
  });

  it('курсор в хвосте и на разделителях относится к ближайшему слева', () => {
    expect(statementAt(stmts(), 0)?.text).toBe('select 1');
    expect(statementAt(stmts(), 8)?.text).toBe('select 1'); // на ';'
    expect(statementAt(stmts(), 14)?.text).toBe('select 1'); // в комментарии
    expect(statementAt(stmts(), TEXT.length)?.text).toBe('select 3'); // за последним символом
  });

  it('пустой список или курсор до первого оператора: null', () => {
    expect(statementAt([], 0)).toBeNull();
    expect(statementAt(stmts(), -1)?.text).toBe('select 1');
  });
});
