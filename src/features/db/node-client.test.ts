import { describe, expect, it } from 'vitest';
import { datasetDump } from '../../../tests/helpers/db';
import { createNodeClient } from './node-client';

describe('createNodeClient', () => {
  it('отдаёт версию PGlite и результаты в виде массивов', async () => {
    const db = await createNodeClient();
    expect(await db.version()).toContain('PostgreSQL 18.3 (PGlite 0.5.8)');
    const [a, b] = await db.exec('select 1 as a; select 2 as b');
    expect(a).toEqual({
      fields: [{ name: 'a', dataTypeID: 23 }],
      rows: [[1]],
      command: 'SELECT',
      rowCount: 1,
    });
    expect(b.rows).toEqual([[2]]);
    await db.close();
  }, 20000);

  it('дамп и загрузка не сдвигают identity', async () => {
    const db = await createNodeClient({ dataDir: await datasetDump('bookstore') });
    const add = `insert into author (name) values ('X') returning author_id`;
    expect((await db.query(add)).rows).toEqual([[7]]);
    const again = await createNodeClient({ dataDir: await db.dump() });
    expect((await again.query(add)).rows).toEqual([[8]]);
    await Promise.all([db.close(), again.close()]);
  }, 20000);
});
