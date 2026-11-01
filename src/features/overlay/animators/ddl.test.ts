import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { traceSql } from '../../../../tests/helpers/trace';
import { testCtx } from '../__fixtures__/traces';
import { buildPlayback } from '../playback';

const ctx = testCtx({
  'public.author': { x: 100, y: 100, width: 400, height: 300 },
  'public.book': { x: 600, y: 100, width: 400, height: 300 },
});

describe('сцены DDL на реальных трассах', () => {
  it('CREATE TABLE рисует пустой черновик по колонкам', () =>
    withDataset('empty', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'create table sample (id int, name text)');
        const phases = buildPlayback(trace, ctx).phases;
        expect(phases.map((phase) => phase.frame.tables[0]?.columns.map((column) => column.name))).toEqual([
          ['id'],
          ['id', 'name'],
        ]);
        expect(phases.at(-1)?.frame.tables[0]).toMatchObject({ dashed: true, rows: [] });
      }),
    ));

  it('ADD COLUMN показывает значения, полученные из базы', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, "alter table author add column city text default 'Москва'");
        const phases = buildPlayback(trace, ctx).phases;
        const table = phases.at(-1)?.frame.tables[0];
        const index = table?.columns.findIndex((column) => column.name === 'city') ?? -1;
        expect(index).toBeGreaterThanOrEqual(0);
        expect(table?.rows[0].values[index]).toBe('Москва');
        expect(table?.columns[index].state).toBe('added');
      }),
    ));

  it('DROP COLUMN гасит колонку, RENAME показывает старое и новое имя', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const drop = buildPlayback(
          await traceSql(db, 'alter table author drop column born_year'),
          ctx,
        ).phases;
        expect(
          drop.some((phase) =>
            phase.frame.tables[0]?.columns.some(
              (column) => column.name === 'born_year' && column.state === 'removed',
            ),
          ),
        ).toBe(true);
        const rename = buildPlayback(
          await traceSql(db, 'alter table author rename column name to full_name'),
          ctx,
        ).phases;
        expect(
          rename.some((phase) =>
            phase.frame.tables[0]?.columns.some(
              (column) => column.name === 'name' && column.state === 'removed',
            ),
          ),
        ).toBe(true);
        expect(rename.at(-1)?.frame.tables[0].columns.some((column) => column.name === 'full_name')).toBe(
          true,
        );
      }),
    ));

  it('ADD CONSTRAINT выделяет колонку и называет ограничение', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'alter table author add constraint name_present check (name is not null)',
        );
        const frame = buildPlayback(trace, ctx).phases.at(-1)?.frame;
        expect(frame?.tables[0].columns.find((column) => column.name === 'name')?.state).toBe('highlight');
        expect(frame?.decorations).toContainEqual(
          expect.objectContaining({ text: expect.stringContaining('name_present') }),
        );
      }),
    ));

  it('DROP TABLE CASCADE показывает исчезновение таблицы и внешнего ключа', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'drop table author cascade');
        const phases = buildPlayback(trace, ctx).phases;
        expect(
          phases.some((phase) =>
            phase.frame.tables.some((table) => table.title === 'author' && table.opacity === 0),
          ),
        ).toBe(true);
        expect(
          phases.some((phase) => phase.frame.decorations.some((decoration) => decoration.kind === 'arrow')),
        ).toBe(true);
      }),
    ));

  it('CREATE SCHEMA создаёт видимую рамку даже без таблиц', () =>
    withDataset('empty', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'create schema shop');
        expect(buildPlayback(trace, ctx).phases.at(-1)?.frame.decorations).toContainEqual(
          expect.objectContaining({ kind: 'schema', name: 'shop' }),
        );
      }),
    ));

  it('CREATE INDEX и COMMENT показывают название индекса и комментарий', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const index = buildPlayback(
          await traceSql(db, 'create index author_name_idx on author (name)'),
          ctx,
        ).phases;
        expect(index.at(-1)?.frame.decorations).toContainEqual(
          expect.objectContaining({ text: expect.stringContaining('author_name_idx') }),
        );
        const comment = buildPlayback(
          await traceSql(db, "comment on table author is 'Авторы книг'"),
          ctx,
        ).phases;
        expect(comment.at(-1)?.frame.decorations).toContainEqual(
          expect.objectContaining({ text: 'Авторы книг' }),
        );
      }),
    ));
});
