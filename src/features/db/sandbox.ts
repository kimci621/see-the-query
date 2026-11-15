import type { Locale } from '@/lib/i18n';
import { type DatasetId, loadDatasetSql } from './datasets';
import { introspect } from './introspect';
import { type DbClient, DbException, type QueryResult, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from './types';

export interface SequenceCheckpoint {
  at: number;
  values: Record<string, string | null>;
}

export interface Sandbox {
  readonly status: 'booting' | 'ready' | 'restarting' | 'failed';
  readonly datasetId: DatasetId | null;
  client(): DbClient; // текущий живой клиент
  loadLesson(
    datasetId: DatasetId,
    journal: readonly string[] | (() => readonly string[]),
    locale?: Locale,
    checkpoints?: readonly SequenceCheckpoint[] | (() => readonly SequenceCheckpoint[]),
  ): Promise<void>;
  whenIdle(): Promise<void>;
  // BEGIN; fn(client); ROLLBACK: всегда, даже при ошибке. Зависание ловит сторож клиента (VS001).
  // signal: превью устаревшего поколения, которое ещё не начало выполняться, отменяется (AbortError)
  preview<T>(fn: (db: DbClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  apply(sql: string): Promise<QueryResult[]>; // exec с автокоммитом, в журнал при успехе
  undo(): Promise<void>; // снапшот датасета + журнал без последнего
  reset(): Promise<void>; // снапшот датасета, журнал пуст
  journal(): readonly string[];
  sequenceCheckpoints(): readonly SequenceCheckpoint[];
  datasetTables(): readonly string[]; // id таблиц самого датасета, без созданных учеником
  subscribe(listener: (e: SandboxEvent) => void): () => void;
}
export type SandboxEvent =
  | { type: 'status'; status: Sandbox['status'] }
  | { type: 'restarted'; reason: 'timeout' | 'crash' }
  | { type: 'rebuilding' } // loadLesson пересобирает базу: схема на доске устарела, новая придёт с changed
  | { type: 'journalChanged' } // последовательность изменилась без успешной команды
  // после apply/undo/reset/loadLesson: пора обновить доску. apply: изменение принёс «Применить»;
  // since - номер его транзакции или меньше: строки, которые он записал, получили xmin >= since
  | { type: 'changed'; apply?: { since: number; command: string | undefined } };

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
const SEQ_STATE = `
  select pg_catalog.format('%I.%I', n.nspname, c.relname), pg_catalog.pg_sequence_last_value(s.seqrelid)::text
  from pg_catalog.pg_sequence s
  join pg_catalog.pg_class c on c.oid = s.seqrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  order by 1
`;

async function sequenceState(db: DbClient): Promise<Map<string, string | null>> {
  const { rows } = await db.query(SEQ_STATE);
  return new Map(rows.map((r) => [String(r[0]), r[1] === null ? null : String(r[1])]));
}

// ponytail: для is_called=false предполагается START WITH 1; для других начальных значений или
// setval(..., false) нужно отдельно читать last_value и is_called у каждой последовательности.
async function setSequence(db: DbClient, seq: string, value: string | null): Promise<void> {
  if (value === null) await db.query('select pg_catalog.setval($1::regclass, 1, false)', [seq]);
  else await db.query('select pg_catalog.setval($1::regclass, $2::bigint, true)', [seq, value]);
}

async function restoreSequences(db: DbClient, before: Map<string, string | null>): Promise<void> {
  const after = await sequenceState(db);
  for (const [seq, value] of before) {
    if (!after.has(seq) || after.get(seq) === value) continue;
    await setSequence(db, seq, value);
  }
}

// Применить = выполнение с COMMIT (спека 3.9): транзакция ученика не остаётся открытой.
// COMMIT и ROLLBACK вне транзакции дают только предупреждение.
async function applyOne(db: DbClient, sql: string): Promise<QueryResult[]> {
  try {
    const res = await db.exec(sql);
    await db.query('commit');
    return res;
  } catch (e) {
    if (!isDeath(e)) await db.query('rollback');
    throw e;
  }
}

export function createSandbox(factory: (dataDir?: Blob) => Promise<DbClient>): Sandbox {
  const snapshots = new Map<string, Blob>();
  const baseTables = new Map<string, string[]>();
  const listeners = new Set<(e: SandboxEvent) => void>();
  let status: Sandbox['status'] = 'booting';
  let datasetId: DatasetId | null = null;
  let locale: Locale = 'ru';
  let journal: string[] = [];
  let checkpoints: SequenceCheckpoint[] = [];
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
  async function rebuild(
    id: DatasetId,
    entries: readonly string[],
    nextLocale: Locale,
    savedCheckpoints: readonly SequenceCheckpoint[],
  ): Promise<void> {
    const key = `${nextLocale}:${id}`;
    const old = db;
    db = null;
    await old?.close();
    const fresh = async (): Promise<DbClient> => {
      const cached = snapshots.get(key);
      const client = await factory(cached);
      if (cached) return client;
      try {
        await client.exec(await loadDatasetSql(id, nextLocale), { initialization: true });
        baseTables.set(
          key,
          (await introspect(client, { sampleRows: 0 })).tables.map((t) => t.id),
        );
        snapshots.set(key, await client.dump());
        return client;
      } catch (e) {
        await client.close();
        throw e;
      }
    };
    let next = await fresh();
    const kept: string[] = [];
    const restoreAt = async (client: DbClient, at: number) => {
      for (const checkpoint of savedCheckpoints.filter((item) => item.at === at))
        for (const [seq, value] of Object.entries(checkpoint.values)) await setSequence(client, seq, value);
    };
    let restored = false;
    for (const [index, sql] of entries.entries()) {
      await restoreAt(next, index);
      try {
        await applyOne(next, sql);
        kept.push(sql);
      } catch (e) {
        // Неудачная запись могла сдвинуть последовательность, поэтому пересобираем только сохранённый префикс.
        if (!isDeath(e)) await next.close();
        next = await fresh();
        for (const [keptIndex, keptSql] of kept.entries()) {
          await restoreAt(next, keptIndex);
          await applyOne(next, keptSql);
        }
        await restoreAt(next, kept.length);
        restored = true;
        break;
      }
    }
    if (!restored) await restoreAt(next, kept.length);
    db = next;
    datasetId = id;
    locale = nextLocale;
    journal = kept;
    checkpoints = savedCheckpoints.filter((checkpoint) => checkpoint.at <= kept.length);
  }

  // Клиент умер (сторож или падение worker'а): поднимаем новый из снапшота + журнала
  async function recover(e: DbException): Promise<void> {
    if (!datasetId) return;
    setStatus('restarting');
    const before = journal;
    try {
      await rebuild(datasetId, journal, locale, checkpoints);
    } catch (err) {
      setStatus('failed');
      throw err;
    }
    setStatus('ready');
    emit({ type: 'restarted', reason: e.db.code === SANDBOX_TIMEOUT ? 'timeout' : 'crash' });
    // База та же, что до смерти. changed перезапустил бы превью, и зависший запрос убивал бы песочницу по кругу.
    // Шлём, только если журнал обрезался
    if (journal.length !== before.length) emit({ type: 'changed' });
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

  async function changeTo(entries: readonly string[], savedCheckpoints = checkpoints): Promise<void> {
    if (!datasetId) throw new Error('Урок не загружен');
    await rebuild(
      datasetId,
      entries,
      locale,
      savedCheckpoints.filter((checkpoint) => checkpoint.at <= entries.length),
    );
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
    sequenceCheckpoints: () => checkpoints,
    datasetTables: () => (datasetId ? (baseTables.get(`${locale}:${datasetId}`) ?? []) : []),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    whenIdle: () => exclusive(async () => {}),

    loadLesson: (id, requestedEntries, nextLocale = 'ru', requestedCheckpoints = []) =>
      exclusive(async () => {
        // Журнал читается после предыдущей команды, даже если переключение уже поставлено в очередь.
        const entries = typeof requestedEntries === 'function' ? requestedEntries() : requestedEntries;
        const savedCheckpoints =
          typeof requestedCheckpoints === 'function' ? requestedCheckpoints() : requestedCheckpoints;
        // тот же датасет и тот же журнал: база уже в нужном состоянии
        if (
          db &&
          id === datasetId &&
          locale === nextLocale &&
          entries.length === journal.length &&
          entries.every((s, i) => s === journal[i]) &&
          JSON.stringify(savedCheckpoints) === JSON.stringify(checkpoints)
        )
          return;
        emit({ type: 'rebuilding' });
        setStatus('booting');
        try {
          await rebuild(id, entries, nextLocale, savedCheckpoints);
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
        // fn может перехватить смерть клиента (трассировщик делает из ошибки эталона стадию error):
        // запоминаем первую, иначе причиной перезапуска стал бы ROLLBACK на мёртвом клиенте (VS002)
        let death: DbException | null = null;
        const spy = <R>(p: Promise<R>) =>
          p.catch((e: unknown) => {
            if (isDeath(e)) death ??= e;
            throw e;
          });
        const watched: DbClient = {
          ...client,
          query: (sql, params) => spy(client.query(sql, params)),
          exec: (sql, opts) => spy(client.exec(sql, opts)),
        };
        const outcome = await fn(watched).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (death) throw death;
        if (!outcome.ok && isDeath(outcome.error)) throw outcome.error;
        await client.query('rollback');
        // внутри превью выполнился COMMIT (даже если потом началась и упала новая транзакция):
        // база изменилась, возвращаем состояние журнала. Последовательности после пересборки и так верные
        const { rows } = await client.query('select pg_xact_status($1::xid8)::text', [started]);
        if (rows[0][0] === 'committed') await changeTo(journal);
        else await restoreSequences(client, sequences);
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      }),

    apply: (sql) =>
      guarded(async () => {
        const db = live();
        // ponytail: xid8 сравнивается с 32-битным xmin как число; верно, пока эпоха xid 0 (учебная песочница)
        const since = Number(
          (await db.query('select pg_snapshot_xmax(pg_current_snapshot())::text')).rows[0][0],
        );
        const before = await sequenceState(db);
        let res: QueryResult[];
        try {
          res = await applyOne(db, sql);
        } catch (e) {
          if (!isDeath(e)) {
            const after = await sequenceState(db);
            const values = Object.fromEntries(
              [...after].filter(([seq, value]) => before.has(seq) && before.get(seq) !== value),
            );
            if (Object.keys(values).length) {
              const at = journal.length;
              const previous = checkpoints.find((checkpoint) => checkpoint.at === at);
              checkpoints = [
                ...checkpoints.filter((checkpoint) => checkpoint.at !== at),
                { at, values: { ...previous?.values, ...values } },
              ];
              emit({ type: 'journalChanged' });
            }
          }
          throw e;
        }
        journal = [...journal, sql];
        emit({
          type: 'changed',
          apply: { since, command: res.findLast((r) => r.command !== 'SELECT')?.command },
        });
        return res;
      }),

    undo: () => guarded(() => (journal.length ? changeTo(journal.slice(0, -1)) : Promise.resolve())),
    reset: () => guarded(() => changeTo([], [])),
  };
}
