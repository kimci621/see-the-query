import { describe, expect, it } from 'vitest';
import { clauseRanges } from '@/features/sql/clauses';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия filter', () => {
  it('вердикты true / false / null, остаются только true', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const filter = stageOf(await traceSql(db, 'select * from book where price > 500'), 'filter');
        const verdicts = Object.values(filter.verdicts);
        expect([
          verdicts.filter((v) => v === true).length,
          verdicts.filter((v) => v === false).length,
          verdicts.filter((v) => v === null).length,
        ]).toEqual([7, 3, 1]);
        // «Остров погибших кораблей» без цены: UNKNOWN
        expect(filter.verdicts['book=(0,7)']).toBeNull();
        expect(filter.output.rows).toHaveLength(7);
        expect(filter.predicateColumns).toEqual(['price']);
        expect(filter.caption).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
      }),
    ));
  it('сравнение с NULL через = не пропускает ни одной строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const filter = stageOf(await traceSql(db, 'select * from book where price = null'), 'filter');
        expect(Object.values(filter.verdicts).every((v) => v === null)).toBe(true);
        expect(filter.output.rows).toHaveLength(0);
      }),
    ));
  it('sourceRange берётся из clauseRanges (кириллица перед WHERE)', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sql = 'select * from book as "Книга" where price > 500';
        await initParser();
        const parsed = parseSql(sql);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const where = clauseRanges(parsed.statements[0]).find((r) => r.clause === 'where');
        const trace = await traceSql(db, sql);
        expect(stageOf(trace, 'scan').output.rows[0].key).toBe('Книга=(0,1)');
        const filter = stageOf(trace, 'filter');
        expect(filter.sourceRange).toEqual({ from: where?.from, to: where?.to });
      }),
    ));
});
