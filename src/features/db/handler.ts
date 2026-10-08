import { PGlite, type Results } from '@electric-sql/pglite';
import { toDbError, type WorkerRequest, type WorkerResponse } from './protocol';
import type { QueryResult } from './types';

function toResult(r: Results<unknown[]>): QueryResult {
  return {
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: r.rows,
    command: r.command,
    // у SELECT affectedRows = 0, поэтому берём число строк
    rowCount: r.affectedRows || r.rows.length,
  };
}

// Обработчик запросов протокола. Живёт внутри worker'а (браузер) или в процессе (node-тесты)
export function createRequestHandler() {
  let pg: PGlite | null = null;

  async function run(req: WorkerRequest): Promise<unknown> {
    if (req.type === 'init') {
      pg = new PGlite(req.dataDir ? { loadDataDir: req.dataDir } : {});
      await pg.waitReady;
      return null;
    }
    if (!pg) throw new Error('База не инициализирована');
    switch (req.type) {
      case 'query':
        return toResult(await pg.query<unknown[]>(req.sql, req.params, { rowMode: 'array' }));
      case 'exec':
        return (await pg.exec(req.sql, { rowMode: 'array' })).map((r) => toResult(r as Results<unknown[]>));
      case 'dump':
        // без checkpoint после загрузки из дампа identity прыгают на ~32 вперёд (WAL логирует последовательности с запасом)
        await pg.exec('checkpoint');
        return pg.dumpDataDir('gzip');
      case 'version':
        return (await pg.query<[string]>('select version()', [], { rowMode: 'array' })).rows[0][0];
    }
  }

  return {
    async handle(req: WorkerRequest): Promise<WorkerResponse> {
      try {
        return { id: req.id, ok: true, value: await run(req) };
      } catch (e) {
        return { id: req.id, ok: false, error: toDbError(e) };
      }
    },
    async close(): Promise<void> {
      await pg?.close();
      pg = null;
    },
  };
}
