import { describe, expect, it } from 'vitest';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { createProber, ident, ProbeOverflow, sqlOf } from './probe';

describe('probe', () => {
  it('строковая проба больше maxRows → ProbeOverflow', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const prober = createProber(db, { maxRows: 5 });
        await expect(prober.rows('select * from book')).rejects.toBeInstanceOf(ProbeOverflow);
        expect((await prober.rows('select * from book where price > 2000')).rows).toHaveLength(2);
      }),
    ));
  it('отменённый signal останавливает следующую пробу до запроса', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const controller = new AbortController();
        const prober = createProber(db, { maxRows: 10, signal: controller.signal });
        await prober.run('select 1');
        controller.abort();
        await expect(prober.run('select 1')).rejects.toMatchObject({ name: 'AbortError' });
      }),
    ));
  it('фрагменты AST в одну строку, идентификаторы в кавычках по нужде', async () => {
    await initParser();
    const parsed = parseSql('select title from book where price > 500 and pages < 100');
    if (!parsed.ok || !('SelectStmt' in parsed.statements[0].ast)) throw new Error('parse');
    const where = parsed.statements[0].ast.SelectStmt.whereClause;
    if (!where) throw new Error('нет WHERE');
    expect(sqlOf(where)).toBe('price > 500 AND pages < 100');
    expect([ident('b'), ident('B'), ident('order')]).toEqual(['b', '"B"', '"order"']);
  });
});
