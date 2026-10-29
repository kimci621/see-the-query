import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('ON CONFLICT', () => {
  it('DO NOTHING: строка сталкивается и отскакивает', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "insert into customer (name, email, created_at) values ('Анна', 'anna@example.com', now()) on conflict (email) do nothing",
        );
        const dml = stageOf(trace, 'dml');
        expect(dml.inserted).toHaveLength(0);
        expect(dml.conflicts).toEqual([{ key: 'customer=(0,1)', action: 'nothing' }]);
        expect(dml.source?.columns.map((column) => column.name)).toEqual(['name', 'email', 'created_at']);
        expect(dml.source?.rows).toHaveLength(1);
        expect(dml.source?.rows[0].values.slice(0, 2)).toEqual(['Анна', 'anna@example.com']);
      }),
    ));

  it('DO UPDATE: обновляет существующую строку, ключ по старому ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "insert into customer (name, email, bonus, created_at) values ('Анна', 'anna@example.com', 200, now()) on conflict (email) do update set bonus = customer.bonus + excluded.bonus",
        );
        const dml = stageOf(trace, 'dml');
        expect(dml.inserted).toHaveLength(0);
        expect(dml.conflicts).toEqual([{ key: 'customer=(0,1)', action: 'update' }]);
        expect(dml.updated[0].after[4]).toBe(320);
      }),
    ));

  it('без цели проверяет все уникальные ключи', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "insert into customer (name, email, created_at) values ('Анна', 'anna@example.com', now()) on conflict do nothing",
        );
        expect(stageOf(trace, 'dml').conflicts).toEqual([{ key: 'customer=(0,1)', action: 'nothing' }]);
      }),
    ));
});
