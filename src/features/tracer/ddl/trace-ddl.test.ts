import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('трассировка DDL', () => {
  it('CREATE TABLE: добавленная таблица, колонки и PK', () =>
    withDataset('empty', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'create table author (author_id bigint generated always as identity primary key, name text not null)',
        );
        const ddl = stageOf(trace, 'ddl');
        expect(ddl.diff.addedTables).toEqual(['public.author']);
        expect(ddl.diff.addedConstraints).toContainEqual({
          tableId: 'public.author',
          name: 'author_pkey',
          kind: 'p',
          columns: ['author_id'],
        });
        expect(ddl.diff.before.tables).toHaveLength(0);
      }),
    ));

  it('ALTER TABLE ADD COLUMN', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'alter table author add column email text');
        expect(stageOf(trace, 'ddl').diff.addedColumns).toEqual([
          { tableId: 'public.author', column: 'email' },
        ]);
      }),
    ));

  it('RENAME COLUMN: из AST, не drop+add', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'alter table author rename column name to full_name');
        const ddl = stageOf(trace, 'ddl');
        expect(ddl.diff.renamedColumns).toEqual([
          { tableId: 'public.author', from: 'name', to: 'full_name' },
        ]);
        expect(ddl.diff.droppedColumns).toHaveLength(0);
      }),
    ));

  it('RENAME TABLE: из AST, не drop+add', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'alter table author rename to writer');
        const ddl = stageOf(trace, 'ddl');
        expect(ddl.diff.renamedTables).toEqual([{ from: 'public.author', to: 'public.writer' }]);
        expect(ddl.diff.addedTables).toEqual([]);
        expect(ddl.diff.droppedTables).toEqual([]);
      }),
    ));

  it('ALTER COLUMN TYPE: старый и новый типы', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'alter table author alter column born_year type bigint');
        expect(stageOf(trace, 'ddl').diff.alteredColumns).toEqual([
          { tableId: 'public.author', column: 'born_year', before: 'integer', after: 'bigint' },
        ]);
      }),
    ));

  it('CREATE INDEX и CREATE VIEW идут как ddl', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'create index on book (price)');
        expect(trace.statementType).toBe('ddl');
        expect(stageOf(trace, 'ddl').diff.addedIndexes).toHaveLength(1);
      }),
    ));

  it('ADD CONSTRAINT CHECK с конфликтными строками: ошибка, нарушители видны', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'alter table employee add constraint salary_check check (salary <= 180000)',
        );
        const error = stageOf(trace, 'error');
        expect(error.error.code).toBe('23514');
        expect(error.conflictKeys).toContain('employee=(0,1)');
      }),
    ));

  it('UNIQUE и NOT NULL показывают конфликтующие строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create temp table t (x int)');
        await db.query('insert into t values (1), (1), (null)');
        const unique = stageOf(
          await traceSql(db, 'alter table t add constraint t_x_key unique (x)'),
          'error',
        );
        expect(unique.error.code).toBe('23505');
        expect(unique.conflictKeys).toEqual(['t=(0,1)', 't=(0,2)']);
        const required = stageOf(await traceSql(db, 'alter table t alter column x set not null'), 'error');
        expect(required.error.code).toBe('23502');
        expect(required.conflictKeys).toEqual(['t=(0,3)']);
      }),
    ));
});
