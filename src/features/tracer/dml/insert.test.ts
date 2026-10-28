import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';
import type { Stage } from '../types';

type DmlStage = Extract<Stage, { kind: 'dml' }> & { defaulted?: string[] };
type ErrorStage = Extract<Stage, { kind: 'error' }> & {
  attempted?: { rows: unknown[] };
  conflictKeys?: string[];
};

describe('трассировка INSERT', () => {
  it('вставка с RETURNING: новая строка, колонки по умолчанию, эталон из RETURNING пользователя', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const t = await traceSql(
          db,
          "insert into author (name, country) values ('Лев Толстой', 'Россия') returning author_id, name",
        );
        expect(t.mode).toBe('full');
        const dml = stageOf(t, 'dml') as DmlStage;
        expect(dml.op).toBe('insert');
        expect(dml.inserted).toEqual(['author=(0,7)']);
        expect(dml.defaulted).toEqual(['author_id', 'born_year']);
        expect(dml.output.rows).toHaveLength(7);
        expect(t.result?.fields.map((f) => f.name)).toEqual(['author_id', 'name']);
        expect(t.result?.rows).toEqual([[7, 'Лев Толстой']]);
      }),
    ));

  it('без RETURNING пользователя эталон пустой, но с командой и числом строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const t = await traceSql(db, "insert into author (name) values ('А'), ('Б')");
        expect(t.result).toMatchObject({ fields: [], rows: [], command: 'INSERT', rowCount: 2 });
        expect(stageOf(t, 'dml').inserted).toHaveLength(2);
      }),
    ));

  it('INSERT выполняется один раз', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await traceSql(db, "insert into author (name) values ('Временный')");
        const r = await db.query('select count(*)::int from author');
        expect(r.rows[0][0]).toBe(7);
      }),
    ));

  it('NOT NULL: фокус по колонке, constraint нет, попытка видна', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const t = await traceSql(db, "insert into author (country) values ('Россия')");
        expect(t.mode).toBe('final-only');
        expect(t.fallbackReason).toBe('Запрос завершился ошибкой');
        const e = stageOf(t, 'error') as ErrorStage;
        expect(e.id).toBe('0:error');
        expect(e.error.code).toBe('23502');
        expect(e.error.constraint).toBeUndefined();
        expect(e.focus.columns).toEqual(['public.author.name']);
        expect(e.attempted?.rows).toEqual([{ key: 'src:0', lineage: {}, values: ['Россия'] }]);
        expect(t.error?.code).toBe('23502');
        const r = await db.query('select count(*)::int from author');
        expect(r.rows[0][0]).toBe(6);
      }),
    ));

  it('FK: в фокусе обе таблицы и колонка ключа', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const t = await traceSql(db, "insert into book (title, author_id) values ('Новая', 99)");
        const e = stageOf(t, 'error');
        expect(e.error.constraint).toBe('book_author_id_fkey');
        expect([...e.focus.tableIds].sort()).toEqual(['public.author', 'public.book']);
        expect(e.focus.columns).toEqual(['public.book.author_id']);
      }),
    ));

  it('UNIQUE: conflictKeys указывает на существующую строку', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const t = await traceSql(
          db,
          "insert into customer (name, email, created_at) values ('Анна', 'anna@example.com', now())",
        );
        const e = stageOf(t, 'error') as ErrorStage;
        expect(e.error.constraint).toBe('customer_email_key');
        expect(e.conflictKeys).toEqual(['customer=(0,1)']);
      }),
    ));

  it('эффект INSERT остаётся в транзакции превью до её отката', () =>
    withDataset('bookstore', async (db) => {
      await inPreview(db, () => traceSql(db, "insert into author (name) values ('Временный')"));
      const r = await db.query('select count(*)::int from author');
      expect(r.rows[0][0]).toBe(6);
    }));
});
