import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('счётчики последовательностей', () => {
  it('показывает изменение identity при вставке нескольких строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, "insert into author (name) values ('А'), ('Б')");
        expect(stageOf(trace, 'dml').sequences).toEqual([{ column: 'author_id', before: 6, after: 8 }]);
      }),
    ));

  it('показывает пустой счётчик serial до первого использования', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table s (id serial, x int)');
        const trace = await traceSql(db, 'insert into s (x) values (1)');
        expect(stageOf(trace, 'dml').sequences).toEqual([{ column: 'id', before: null, after: 1 }]);
      }),
    ));

  it('не показывает счётчик, если последовательность не менялась', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table s (id serial, x int)');
        const trace = await traceSql(db, 'insert into s (id, x) values (42, 1)');
        expect(stageOf(trace, 'dml').sequences).toBeUndefined();
      }),
    ));

  it('не показывает счётчик у таблицы без последовательностей', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table plain (x int)');
        const trace = await traceSql(db, 'insert into plain values (1)');
        expect(stageOf(trace, 'dml').sequences).toBeUndefined();
      }),
    ));

  it('сохраняет точность больших значений bigint', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query(
          'create temp table s (id bigint generated always as identity (start with 9007199254740993))',
        );
        const trace = await traceSql(db, 'insert into s default values');
        expect(stageOf(trace, 'dml').sequences).toEqual([
          { column: 'id', before: null, after: '9007199254740993' },
        ]);
      }),
    ));

  it('показывает изменение последовательности при вставке через MERGE', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "merge into author a using (values ('Новый')) as s(name) on false when not matched then insert (name) values (s.name)",
        );
        expect(stageOf(trace, 'dml').sequences).toEqual([{ column: 'author_id', before: 6, after: 7 }]);
      }),
    ));
});
