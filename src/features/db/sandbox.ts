import { type DatasetId, loadDatasetSql } from './datasets';
import { type DbClient, DbException, type QueryResult, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from './types';

export interface Sandbox {
  readonly status: 'booting' | 'ready' | 'restarting' | 'failed';
  readonly datasetId: DatasetId | null;
  client(): DbClient; // текущий живой клиент
  loadLesson(datasetId: DatasetId, journal: readonly string[]): Promise<void>;
  // BEGIN; fn(client); ROLLBACK: всегда, даже при ошибке. Зависание ловит сторож клиента (VS001).
  // signal: превью устаревшего поколения, которое ещё не начало выполняться, отменяется (AbortError)
  preview<T>(fn: (db: DbClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  apply(sql: string): Promise<QueryResult[]>; // exec с автокоммитом, в журнал при успехе
  undo(): Promise<void>; // снапшот датасета + журнал без последнего
  reset(): Promise<void>; // снапшот датасета, журнал пуст
  journal(): readonly string[];
  subscribe(listener: (e: SandboxEvent) => void): () => void;
}
export type SandboxEvent =
  | { type: 'status'; status: Sandbox['status'] }
  | { type: 'restarted'; reason: 'timeout' | 'crash' }
  | { type: 'changed' }; // после apply/undo/reset/loadLesson: пора обновить доску

const isDeath = (e: unknown): e is DbException =>
  e instanceof DbException && (e.db.code === SANDBOX_TIMEOUT || e.db.code === SANDBOX_CRASHED);

// id текущей транзакции; null, если она прервана ошибкой (это всё ещё наша транзакция)
async function xactId(db: DbClient): Promise<string | null> {
  try {
    return String((await db.query('select pg_current_xact_id()::text')).rows[0][0]);
  } catch (e) {
    if (e instanceof DbException && e.db.code === '25P02') return null;
    throw e;
  }
}

// Последовательности не откатываются вместе с транзакцией: снимаем их до превью и возвращаем после
const SEQ_STATE = 'select seqrelid::regclass::text, pg_sequence_last_value(seqrelid)::text from pg_sequence';

async function sequenceState(db: DbClient): Promise<Map<string, string | null>> {
  const { rows } = await db.query(SEQ_STATE);
  return new Map(rows.map((r) => [String(r[0]), r[1] === null ? null : String(r[1])]));
}

// ponytail: setval(seq, 1, false) предполагает START WITH 1; при нужде читать seqstart из pg_sequence
async function restoreSequences(db: DbClient, before: Map<string, string | null>): Promise<void> {
  const after = await sequenceState(db);
  for (const [seq, value] of before) {
    if (after.get(seq) === value) continue;
    // null: последовательность ещё ни разу не выдавала значение
    if (value === null) await db.query('select setval($1::regclass, 1, false)', [seq]);
    else await db.query('select setval($1::regclass, $2::bigint, true)', [seq, value]);
  }
}

export function createSandbox(factory: (dataDir?: Blob) => Promise<DbClient>): Sandbox {
  const snapshots = new Map<DatasetId, Blob>();
  const listeners = new Set<(e: SandboxEvent) => void>();
  let status: Sandbox['status'] = 'booting';
  let datasetId: DatasetId | null = null;
  let journal: string[] = [];
  let db: DbClient | null = null;
  let lock: Promise<unknown> = Promise.resolve();

  const emit = (e: SandboxEvent) => {
    for (const l of listeners) l(e);
  };
  const setStatus = (s: Sandbox['status']) => {
    if (s === status) return;
    status = s;
    emit({ type: 'status', status: s });
  };
  const live = (): DbClient => {
    if (!db) throw new DbException({ code: SANDBOX_CRASHED, message: 'Песочница не готова' });
    return db;
  };

  // Операции идут строго по одной: превью, применение и пересборка не перемешиваются
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn);
    lock = run.catch(() => {});
    return run;
  }

  // Новый клиент: снапшот датасета (из кэша или собранный сейчас) + повтор журнала.
  // Запись журнала, которая больше не выполняется, и всё после неё отбрасываются.
  async function rebuild(id: DatasetId, entries: readonly string[]): Promise<void> {
    const old = db;
    db = null;
    await old?.close();
    const cached = snapshots.get(id);
    const next = await factory(cached);
    if (!cached) {
      await next.exec(await loadDatasetSql(id));
      snapshots.set(id, await next.dump());
    }
    const kept: string[] = [];
    for (const sql of entries) {
      try {
        await next.exec(sql);
        kept.push(sql);
      } catch (e) {
        if (isDeath(e)) throw e;
        break;
      }
    }
    db = next;
    datasetId = id;
    journal = kept;
  }

  // Клиент умер (сторож или падение worker'а): поднимаем новый из снапшота + журнала
  async function recover(e: DbException): Promise<void> {
    if (!datasetId) return;
    setStatus('restarting');
    try {
      await rebuild(datasetId, journal);
    } catch (err) {
      setStatus('failed');
      throw err;
    }
    setStatus('ready');
    emit({ type: 'restarted', reason: e.db.code === SANDBOX_TIMEOUT ? 'timeout' : 'crash' });
    emit({ type: 'changed' });
  }

  function guarded<T>(fn: () => Promise<T>): Promise<T> {
    return exclusive(async () => {
      try {
        return await fn();
      } catch (e) {
        if (isDeath(e)) await recover(e);
        throw e;
      }
    });
  }

  async function changeTo(entries: readonly string[]): Promise<void> {
    if (!datasetId) throw new Error('Урок не загружен');
    await rebuild(datasetId, entries);
    emit({ type: 'changed' });
  }

  return {
    get status() {
      return status;
    },
    get datasetId() {
      return datasetId;
    },
    client: live,
    journal: () => journal,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    loadLesson: (id, entries) =>
      exclusive(async () => {
        // тот же датасет и тот же журнал: база уже в нужном состоянии
        if (
          db &&
          id === datasetId &&
          entries.length === journal.length &&
          entries.every((s, i) => s === journal[i])
        )
          return;
        setStatus('booting');
        try {
          await rebuild(id, entries);
        } catch (e) {
          setStatus('failed');
          throw e;
        }
        setStatus('ready');
        emit({ type: 'changed' });
      }),

    preview: (fn, signal) =>
      guarded(async () => {
        signal?.throwIfAborted();
        const client = live();
        const sequences = await sequenceState(client);
        await client.query('begin');
        const started = await xactId(client);
        const outcome = await fn(client).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (!outcome.ok && isDeath(outcome.error)) throw outcome.error;
        const now = await xactId(client);
        await client.query('rollback');
        await restoreSequences(client, sequences);
        // внутри превью выполнился COMMIT: база изменилась, возвращаем состояние журнала
        if (now !== null && now !== started) await changeTo(journal);
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      }),

    apply: (sql) =>
      guarded(async () => {
        const res = await live().exec(sql);
        journal = [...journal, sql];
        emit({ type: 'changed' });
        return res;
      }),

    undo: () => guarded(() => (journal.length ? changeTo(journal.slice(0, -1)) : Promise.resolve())),
    reset: () => guarded(() => changeTo([])),
  };
}
