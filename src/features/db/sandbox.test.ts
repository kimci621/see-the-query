import { describe, expect, it, vi } from 'vitest';
import { createNodeClient } from './node-client';
import { createSandbox, type SandboxEvent } from './sandbox';
import { type DbClient, DbException, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from './types';

const T = 20000;
const count = async (db: DbClient, table: string) =>
  (await db.query(`select count(*)::int from ${table}`)).rows[0][0];

// Node-клиент, который изображает сторож и падение worker'а:
// запрос с pg_sleep «зависает» (VS001), запрос с __crash__ роняет worker (VS002). После этого клиент мёртв.
async function mortalClient(dataDir?: Blob): Promise<DbClient> {
  const real = await createNodeClient({ dataDir });
  let dead = false;
  const check = async (sql: string) => {
    if (dead) throw new DbException({ code: SANDBOX_CRASHED, message: 'closed' });
    const code = sql.includes('pg_sleep')
      ? SANDBOX_TIMEOUT
      : sql.includes('__crash__')
        ? SANDBOX_CRASHED
        : null;
    if (!code) return;
    dead = true;
    await real.close();
    throw new DbException({ code, message: code });
  };
  return {
    query: async (sql, params) => {
      await check(sql);
      return real.query(sql, params);
    },
    exec: async (sql) => {
      await check(sql);
      return real.exec(sql);
    },
    dump: () => real.dump(),
    version: () => real.version(),
    close: async () => {
      if (!dead) await real.close();
      dead = true;
    },
  };
}

async function bookstore(journal: string[] = []) {
  const factory = vi.fn(mortalClient);
  const sandbox = createSandbox(factory);
  const events: SandboxEvent[] = [];
  sandbox.subscribe((e) => events.push(e));
  await sandbox.loadLesson('bookstore', journal);
  return { sandbox, factory, events };
}

describe('sandbox: загрузка урока', () => {
  it(
    'собирает снапшот один раз и переиспользует его',
    async () => {
      const { sandbox, factory, events } = await bookstore();
      expect(sandbox.status).toBe('ready');
      expect(events).toEqual([
        { type: 'rebuilding' },
        { type: 'status', status: 'ready' },
        { type: 'changed' },
      ]);
      expect(await count(sandbox.client(), 'book')).toBe(11);
      expect(factory).toHaveBeenLastCalledWith(undefined);

      events.length = 0;
      await sandbox.loadLesson('bookstore', []); // тот же датасет и журнал: без пересборки
      expect(factory).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]); // схема на доске остаётся верной

      await sandbox.loadLesson('bookstore', [`insert into author (name) values ('Новый')`]);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(factory.mock.calls[1][0]).toBeInstanceOf(Blob); // второй раз из снапшота
      expect(await count(sandbox.client(), 'author')).toBe(7);
    },
    T,
  );

  it(
    'обрезает журнал на первой записи, которая больше не выполняется',
    async () => {
      const ok = `insert into author (name) values ('A')`;
      const { sandbox } = await bookstore([ok, 'insert into nope values (1)', ok]);
      expect(sandbox.journal()).toEqual([ok]);
      expect(await count(sandbox.client(), 'author')).toBe(7);
    },
    T,
  );
});

describe('sandbox: превью', () => {
  it(
    'превью INSERT не сдвигает identity',
    async () => {
      const { sandbox } = await bookstore();
      for (let i = 0; i < 3; i++) {
        await sandbox.preview((db) => db.query("insert into author (name) values ('X') returning author_id"));
      }
      const [res] = await sandbox.apply(
        "insert into author (name) values ('Лев Толстой') returning author_id",
      );
      expect(Number(res.rows[0][0])).toBe(7);
    },
    T,
  );

  it(
    'изменения видны внутри и исчезают после',
    async () => {
      const { sandbox } = await bookstore();
      const inside = await sandbox.preview(async (db) => {
        await db.query('delete from review');
        return count(db, 'review');
      });
      expect(inside).toBe(0);
      expect(await count(sandbox.client(), 'review')).toBe(10);
    },
    T,
  );

  it(
    'ошибка внутри пробрасывается, следующее превью работает',
    async () => {
      const { sandbox } = await bookstore();
      await expect(sandbox.preview((db) => db.query('select nme from book'))).rejects.toMatchObject({
        db: { code: '42703' },
      });
      expect(await sandbox.preview((db) => count(db, 'book'))).toBe(11);
    },
    T,
  );

  it(
    'COMMIT внутри превью не протекает в базу',
    async () => {
      const { sandbox, events } = await bookstore();
      await sandbox.preview(async (db) => {
        await db.query('delete from review');
        await db.query('commit');
      });
      expect(await count(sandbox.client(), 'review')).toBe(10);
      expect(events.at(-1)).toEqual({ type: 'changed' });
    },
    T,
  );

  it(
    'отменённое превью не выполняется',
    async () => {
      const { sandbox } = await bookstore();
      const ctrl = new AbortController();
      ctrl.abort();
      const fn = vi.fn(async () => 1);
      await expect(sandbox.preview(fn, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(fn).not.toHaveBeenCalled();
    },
    T,
  );
});

describe('sandbox: применить, отменить, сбросить', () => {
  const add = `insert into author (name) values ('Лев Толстой') returning author_id`;

  it(
    'apply пишет в журнал только успешное',
    async () => {
      const { sandbox, events } = await bookstore();
      const [res] = await sandbox.apply(add);
      expect(res.rows).toEqual([[7]]);
      expect(events.at(-1)).toEqual({ type: 'changed' });
      await expect(sandbox.apply('insert into author (name) values (null)')).rejects.toMatchObject({
        db: { code: '23502' },
      });
      expect(sandbox.journal()).toEqual([add]);
    },
    T,
  );

  it(
    'undo возвращает и данные, и последовательности',
    async () => {
      const { sandbox } = await bookstore();
      await sandbox.apply(add);
      await sandbox.apply(add);
      await sandbox.undo();
      expect(sandbox.journal()).toEqual([add]);
      expect(await count(sandbox.client(), 'author')).toBe(7);
      // identity не «помнит» отменённую строку: следующий id снова 8
      expect((await sandbox.apply(add))[0].rows).toEqual([[8]]);
    },
    T,
  );

  it(
    'reset возвращает датасет как был',
    async () => {
      const { sandbox } = await bookstore();
      await sandbox.apply('delete from review');
      await sandbox.reset();
      expect(sandbox.journal()).toEqual([]);
      expect(await count(sandbox.client(), 'review')).toBe(10);
    },
    T,
  );
});
describe('sandbox: восстановление', () => {
  it(
    'после таймаута поднимается из снапшота и журнала',
    async () => {
      const { sandbox, events } = await bookstore();
      await sandbox.apply('delete from review');
      events.length = 0;
      await expect(sandbox.preview((db) => db.query('select pg_sleep(10)'))).rejects.toMatchObject({
        db: { code: SANDBOX_TIMEOUT },
      });
      expect(events).toEqual([
        { type: 'status', status: 'restarting' },
        { type: 'status', status: 'ready' },
        { type: 'restarted', reason: 'timeout' },
        { type: 'changed' },
      ]);
      expect(await count(sandbox.client(), 'review')).toBe(0);
      expect(sandbox.journal()).toEqual(['delete from review']);
    },
    T,
  );

  it(
    'после падения worker’а на apply журнал не меняется',
    async () => {
      const { sandbox, events } = await bookstore();
      await expect(sandbox.apply('select 1 as __crash__')).rejects.toMatchObject({
        db: { code: SANDBOX_CRASHED },
      });
      expect(events).toContainEqual({ type: 'restarted', reason: 'crash' });
      expect(sandbox.journal()).toEqual([]);
      expect(await count(sandbox.client(), 'book')).toBe(11);
    },
    T,
  );
});

describe('sandbox: транзакции ученика', () => {
  it(
    'превью с DROP и COMMIT не оставляет изменений',
    async () => {
      const { sandbox } = await bookstore();
      await sandbox.preview((db) => db.exec('drop table review; commit'));
      expect(await count(sandbox.client(), 'review')).toBe(10);
    },
    T,
  );

  it(
    'COMMIT и упавшая новая транзакция внутри превью не протекают',
    async () => {
      const { sandbox } = await bookstore();
      await expect(
        sandbox.preview((db) => db.exec('delete from review; commit; begin; select 1/0')),
      ).rejects.toMatchObject({ db: { code: '22012' } });
      expect(await count(sandbox.client(), 'review')).toBe(10);
    },
    T,
  );

  it(
    'apply BEGIN не оставляет открытую транзакцию: превью не откатывает применённое',
    async () => {
      const { sandbox } = await bookstore();
      await sandbox.apply('begin');
      await sandbox.apply('delete from review');
      await sandbox.preview((db) => db.query('select 1'));
      expect(await count(sandbox.client(), 'review')).toBe(0);
    },
    T,
  );

  it(
    'apply с упавшей транзакцией не ломает следующее превью',
    async () => {
      const { sandbox } = await bookstore();
      await expect(sandbox.apply('begin; select 1/0')).rejects.toMatchObject({ db: { code: '22012' } });
      expect(await sandbox.preview((db) => count(db, 'book'))).toBe(11);
    },
    T,
  );

  it(
    'запись журнала, на которой умер клиент, обрезает журнал, а не роняет песочницу',
    async () => {
      const ok = `insert into author (name) values ('A')`;
      const { sandbox } = await bookstore([ok, 'select pg_sleep(1)', ok]);
      expect(sandbox.status).toBe('ready');
      expect(sandbox.journal()).toEqual([ok]);
      expect(await count(sandbox.client(), 'author')).toBe(7);
    },
    T,
  );
});
