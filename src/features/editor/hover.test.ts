import { beforeAll, describe, expect, it } from 'vitest';
import { initParser } from '@/features/sql/parser';
import { columnContextAt } from './hover';

beforeAll(async () => {
  await initParser();
});

describe('columnContextAt', () => {
  it('колонка под курсором с контекстом таблиц оператора', () => {
    const text = 'select b.title from book b join author a on b.author_id = a.author_id';
    // позиции: 'b.title' начинается на 7
    const ctx = columnContextAt(text, 9);
    expect(ctx?.column.name).toBe('title');
    expect(ctx?.column.qualifier).toBe('b');
    expect(ctx?.tables.map((t) => t.name)).toEqual(['book', 'author']);
  });

  it('позиция вне колонок и кириллический запрос', () => {
    const text = "select 'Привет' as x, b.title from book b";
    expect(columnContextAt(text, 5)).toBeNull(); // внутри строки
    const ctx = columnContextAt(text, 24);
    expect(ctx?.column.name).toBe('title');
  });

  it('невалидный текст даёт null без исключения', () => {
    expect(columnContextAt('select fro', 5)).toBeNull();
  });
});
