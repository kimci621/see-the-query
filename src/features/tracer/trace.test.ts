import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { column, stageOf, summary, traceSql } from '../../../tests/helpers/trace';

// Ошибка трассировщика под видом БД: строки выбранных проб испорчены (по умолчанию переставлены)
function tampered(
  db: DbClient,
  pick: (sql: string) => boolean,
  change = (rows: unknown[][]) => [...rows].reverse(),
): DbClient {
  return {
    query: async (sql, params) => {
      const r = await db.query(sql, params);
      return pick(sql) ? { ...r, rows: change(r.rows) } : r;
    },
    exec: (sql) => db.exec(sql),
    dump: () => db.dump(),
    version: () => db.version(),
    close: () => db.close(),
  };
}

describe('traceStatement', () => {
  it('ошибка Postgres → стадия error с фокусом на таблице', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select nme from book');
        expect(trace).toMatchObject({ mode: 'final-only', result: null, error: { code: '42703' } });
        expect(stageOf(trace, 'error').focus.tableIds).toEqual(['public.book']);
        // транзакция превью жива после ошибки
        expect((await db.query('select count(*)::int from book')).rows).toEqual([[11]]);
      }),
    ));
  it('команды транзакций не выполняются', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'rollback');
        expect(trace).toMatchObject({ mode: 'final-only', statementType: 'tcl', result: null, stages: [] });
      }),
    ));
  it('неподдерживаемый оператор: final-only с эталоном и touched', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'with t as (select count(*) from book) select * from t');
        expect(trace).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: WITH',
          stages: [],
        });
        expect(trace.result?.rows).toEqual([[11]]);
        expect(trace.touched.tableIds).toEqual(['public.book']);
      }),
    ));
  it('представление: final-only, у него нет ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create view cheap as select title, price from book where price < 500');
        const trace = await traceSql(db, 'select * from cheap', { schema: await introspect(db) });
        expect(trace).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: представление',
        });
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));
  it('volatile: одно вычисление на все стадии, метка volatile', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, random() as r from book order by r');
        expect(trace.mode).toBe('full');
        expect(trace.stages.map((s) => `${s.kind}:${s.volatile ?? false}`)).toEqual([
          'scan:false',
          'project:true',
          'sort:true',
        ]);
        const r = column(stageOf(trace, 'sort'), 'r') as number[];
        expect([...r].sort((a, b) => a - b)).toEqual(r);
      }),
    ));
  it('volatile в ORDER BY с LIMIT: строки окна случайны, только final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        for (const sql of [
          'select title from book order by random() limit 3',
          'select title, random() as r from book order by r limit 3',
          'select title, random() as r from book order by 2 offset 1',
        ])
          expect((await traceSql(db, sql)).mode, sql).toBe('final-only');
      }),
    ));
  it('volatile в SELECT и ничья на границе OFFSET: строки окна те, что вернул Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, random() from book order by price limit 4 offset 1');
        expect(trace.mode).toBe('full');
        expect(column(stageOf(trace, 'limit'), 'title')).toEqual((trace.result?.rows ?? []).map((r) => r[0]));
      }),
    ));
  it('volatile-ключ после скрытого: неверный порядок серий ведущего ключа → final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        // price нет в выходе, random() разбивает ничьи: сверяется порядок серий price
        const sql = 'select title from book order by price, random()';
        expect((await traceSql(db, sql)).mode).toBe('full');
        expect((await traceSql(db, 'select title from book order by lower(title) desc, random()')).mode).toBe(
          'full',
        );
        // Проба P отдала строки задом наперёд: стадия sort идёт по убыванию price
        const broken = await traceSql(
          tampered(db, (q) => q.includes('__vs_k0')),
          sql,
        );
        expect(broken.mode).toBe('final-only');
        expect(broken.fallbackReason).toBe('Сверка с прямым выполнением не сошлась');
      }),
    ));
  it('ошибка пробы в сжатом режиме → final-only, а не исключение', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select * from book where 1/(price - 610) > 0 limit 1', {
          maxRows: 3,
        });
        expect(trace.mode).toBe('final-only');
        expect(trace.fallbackReason).toMatch(/^Проба не удалась/);
      }),
    ));
  it('infinity в дате не ломает сверку', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select title, 'infinity'::timestamptz as t from book order by title",
        );
        expect(trace.mode).toBe('full');
      }),
    ));
  it('(t).* и функция, возвращающая множество → final-only, а не исключение', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        expect((await traceSql(db, 'select (book).* from book')).mode).toBe('final-only');
        const srf = await traceSql(db, 'select title, unnest(array[1,1]) as x from book order by title');
        expect(srf.mode).toBe('final-only');
      }),
    ));
  it('больше maxRows строк → сжатый режим с точными счётчиками', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book where price > 500 order by price limit 3', {
          maxRows: 5,
        });
        expect(trace.mode).toBe('full');
        expect(summary(trace)).toBe('scan:11 > filter:7 > project:7 > sort:7 > limit:3');
        expect(trace.stages.every((s) => s.compressed && s.output.rows.length === 0)).toBe(true);
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));
  it('сжатый режим: значения и порядок итога сверяются с прямым выполнением', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        // Счётчики проб целы (по одной строке), портятся только многострочные пробы, эталон нет
        const opts = { maxRows: 5, schema: await introspect(db) };
        const ordered = 'select title from book where price > 500 order by price limit 3';
        const plain = 'select title from book where price > 500';
        for (const sql of [
          ordered,
          plain,
          'select title, price from book order by price fetch first 3 rows with ties',
          'select distinct on (category_id) category_id, title from book order by category_id, price desc',
          'select distinct category_id from book order by 1',
          'select author_id, count(*) from book group by author_id having count(*) > 1 order by 2 desc, 1',
          'select title, random() as r from book order by price',
          'select title from book order by price, random()',
          'select b.title, a.name from book b join author a on a.author_id = b.author_id order by a.name, b.title limit 4',
        ])
          expect((await traceSql(db, sql, opts)).mode, sql).toBe('full');
        const reversed = await traceSql(
          tampered(db, (q) => q !== ordered),
          ordered,
          opts,
        );
        const sameFirst = await traceSql(
          tampered(
            db,
            (q) => q !== plain,
            (rows) => rows.map(() => rows[0]),
          ),
          plain,
          opts,
        );
        for (const t of [reversed, sameFirst]) {
          expect(t.mode, t.sql).toBe('final-only');
          expect(t.fallbackReason, t.sql).toBe('Сверка с прямым выполнением не сошлась');
        }
      }),
    ));
  it('отменённый signal прерывает трассу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(traceSql(db, 'select * from book', { signal: controller.signal })).rejects.toMatchObject(
          { name: 'AbortError' },
        );
      }),
    ));
});
