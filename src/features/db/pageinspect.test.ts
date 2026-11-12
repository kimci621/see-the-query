import { describe, expect, it } from 'vitest';
import { runMvccScene } from '../scenes/mvcc-scene';
import { createNodeClient } from './node-client';
import { classifyVersions, readHeapPage } from './pageinspect';

describe('pageinspect: версии строк', () => {
  it('учитывает отменённую вставку, блокировку и указатели страницы', () => {
    const items = [
      { lp: 1, lpFlags: 1, xmin: 100, xmax: 0, ctid: '(0,1)' },
      { lp: 2, lpFlags: 1, xmin: 100, xmax: 101, ctid: '(0,4)' },
      { lp: 3, lpFlags: 1, xmin: 102, xmax: 0, ctid: '(0,3)' },
      { lp: 4, lpFlags: 1, xmin: 100, xmax: 102, ctid: '(0,4)' },
      { lp: 5, lpFlags: 1, xmin: 100, xmax: 103, ctid: '(0,5)' },
      { lp: 6, lpFlags: 0, xmin: 0, xmax: 0, ctid: null },
      { lp: 7, lpFlags: 2, xmin: 0, xmax: 0, ctid: null },
      { lp: 8, lpFlags: 3, xmin: 0, xmax: 0, ctid: null },
    ];
    expect(classifyVersions(items, { committed: [100, 101, 103], aborted: [102], lockers: [103] })).toEqual([
      { lp: 1, state: 'live' },
      { lp: 2, state: 'dead' },
      { lp: 3, state: 'aborted' },
      { lp: 4, state: 'live' },
      { lp: 5, state: 'locked' },
      { lp: 6, state: 'unused' },
      { lp: 7, state: 'redirect' },
      { lp: 8, state: 'dead' },
    ]);
  });

  it('после сбоя откатывает транзакцию и удаляет только свою схему', async () => {
    const db = await createNodeClient();
    try {
      await db.query('create table vs_mvcc (id int)');
      const failing = {
        ...db,
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('update ')) throw new Error('сбой сцены');
          return db.query(sql, params);
        },
      };
      await expect(runMvccScene(failing)).rejects.toThrow('сбой сцены');
      expect(
        (await db.query("select nspname from pg_namespace where nspname like 'vs_mvcc_%'")).rows,
      ).toEqual([]);
      expect((await db.query("select to_regclass('vs_mvcc')::text")).rows).toEqual([['vs_mvcc']]);
      await expect(db.query('savepoint no_open_transaction')).rejects.toMatchObject({
        db: { code: '25P01' },
      });
    } finally {
      await db.close();
    }
  }, 60_000);

  it('снимает настоящие страницы на каждом шаге и не трогает чужие таблицы', async () => {
    const db = await createNodeClient();
    try {
      await db.exec('create table vs_mvcc (id int); insert into vs_mvcc values (42)');
      const steps = await runMvccScene(db);
      expect(steps).toHaveLength(6);
      expect(steps[0].visible).toHaveLength(3);
      expect(steps[1].visible).toContainEqual({ id: '1', val: 'a2' });
      expect(
        classifyVersions(steps[1].versions, steps[1].facts).filter((v) => v.state === 'dead'),
      ).toHaveLength(1);
      expect(steps[2].visible).toHaveLength(2);
      const aborted = classifyVersions(steps[3].versions, steps[3].facts);
      expect(aborted.filter((v) => v.state === 'dead')).toHaveLength(2);
      expect(aborted.filter((v) => v.state === 'aborted')).toHaveLength(1);
      expect(steps[3].visible).toContainEqual({ id: '3', val: 'c' });
      expect(classifyVersions(steps[4].versions, steps[4].facts).some((v) => v.state === 'locked')).toBe(
        true,
      );
      const vacuum = classifyVersions(steps[5].versions, steps[5].facts);
      expect(vacuum.some((v) => v.state === 'dead' || v.state === 'aborted')).toBe(false);
      expect(vacuum.some((v) => v.state === 'redirect' || v.state === 'unused')).toBe(true);
      expect((await db.query('select id from vs_mvcc')).rows).toEqual([[42]]);
      expect(
        (await db.query("select nspname from pg_namespace where nspname like 'vs_mvcc_%'")).rows,
      ).toEqual([]);
      expect(await readHeapPage(db, 'vs_mvcc', 0)).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 60_000);
});
