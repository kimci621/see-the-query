import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия sort', () => {
  it('DESC NULLS LAST: NULL в конце, ключи для подписи', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sort = stageOf(
          await traceSql(db, 'select title, price from book order by price desc nulls last'),
          'sort',
        );
        expect(column(sort, 'price')).toEqual([
          '3200.00',
          '2400.00',
          '1990.00',
          '890.00',
          '610.00',
          '610.00',
          '560.00',
          '420.00',
          '350.00',
          '350.00',
          null,
        ]);
        expect(sort.sortKeys).toEqual(['price DESC NULLS LAST']);
        expect(sort.order).toEqual(sort.output.rows.map((r) => r.key));
        expect(sort.caption).toBe('ORDER BY price DESC NULLS LAST: 11 строк по порядку');
      }),
    ));
  it('ключ-ключевое слово: подпись без кавычек, ключ в кавычках', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sort = stageOf(
          await traceSql(db, 'select name, position, salary from employee order by position, salary desc'),
          'sort',
        );
        expect(sort.sortKeys).toEqual(['"position"', 'salary DESC']);
        expect(sort.caption).toBe('ORDER BY position, salary DESC: 8 строк по порядку');
      }),
    ));
  it('keyColumns: номера колонок выхода под ключом, без разбора SQL-текста', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const cases: Array<[string, number[]]> = [
          ['select title, price from book order by 2 desc', [1]],
          ['select b.title, b.price from book b order by b.price', [1]],
          ['select title, price from book order by lower(title)', [0]],
          ['select price, lower(title) from book order by lower(title)', [1]],
          ['select title, price as cost from book order by price', [1]],
          ['select name, position, salary from employee order by position, salary desc', [1, 2]],
          ['select title from book order by price', []],
          // USING: слитая колонка принадлежит левой стороне, ключ правой стороны ведёт к ней
          ['select * from book b join author a using (author_id) order by a.author_id', [0]],
          ['select * from author a join book b using (author_id) order by b.author_id', [0]],
        ];
        for (const [sql, keys] of cases) {
          for (const maxRows of [undefined, 5]) {
            const trace = await traceSql(db, sql, maxRows ? { maxRows } : {});
            expect(trace.mode, `${sql}: ${trace.fallbackReason}`).toBe('full');
            expect(stageOf(trace, 'sort').keyColumns, `${sql}, maxRows ${maxRows}`).toEqual(keys);
          }
        }
      }),
    ));
  it('по номеру колонки, по алиасу и по колонке вне SELECT', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const byNumber = stageOf(
          await traceSql(db, 'select title, price from book order by 2 desc, title'),
          'sort',
        );
        expect(column(byNumber, 'title').slice(0, 2)).toEqual(['Остров погибших кораблей', 'Изучаем Python']);
        const byAlias = stageOf(
          await traceSql(db, 'select title, price * 2 as p from book order by p'),
          'sort',
        );
        expect(column(byAlias, 'p')[0]).toBe('700.00');
        const hidden = await traceSql(db, 'select title from book order by price desc nulls last');
        expect(hidden.mode).toBe('full');
        expect(column(stageOf(hidden, 'sort'), 'title')[0]).toBe('Изучаем Python');
      }),
    ));
  it('ничьи стоят в порядке Postgres: итог стадии по порядку равен результату', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        for (const sql of [
          'select title, price from book order by price desc',
          'select name, position, salary from employee order by position, salary desc',
        ]) {
          const trace = await traceSql(db, sql);
          expect(trace.mode, trace.fallbackReason).toBe('full');
          expect(
            stageOf(trace, 'sort').output.rows.map((r) => r.values),
            sql,
          ).toEqual(trace.result?.rows);
        }
      }),
    ));
  it('ключ вне выхода и выражение: порядок сверяется целиком, ничьи и random() не роняют', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        // order by price: price нет в выходе, у 610.00 и 350.00 по две книги
        for (const sql of [
          'select title from book order by price',
          'select title from book order by price desc, lower(title)',
          'select author_id from book group by author_id order by count(*) desc',
          'select title from book order by price, random()',
          'select title, random() as r from book order by price',
        ]) {
          const trace = await traceSql(db, sql);
          expect(trace.mode, `${sql}: ${trace.fallbackReason}`).toBe('full');
        }
        const hidden = await traceSql(db, 'select title from book order by price');
        expect(stageOf(hidden, 'sort').output.rows.map((r) => r.values)).toEqual(hidden.result?.rows);
      }),
    ));
});
