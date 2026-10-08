import type { WorkerRequest, WorkerResponse } from './protocol';
import {
  type DbClient,
  type DbError,
  DbException,
  type QueryResult,
  SANDBOX_CRASHED,
  SANDBOX_TIMEOUT,
} from './types';

// Транспорт до обработчика: Worker в браузере, вызов в процессе в node, подделка в тестах
export interface RpcPort {
  post(req: WorkerRequest): void;
  onMessage(cb: (res: WorkerResponse) => void): void;
  onError(cb: () => void): void;
  terminate(): void | Promise<void>;
}
export interface WorkerClientOptions {
  dataDir?: Blob;
  timeoutMs?: number; // по умолчанию 3000
}
export interface RpcOptions extends WorkerClientOptions {
  initTimeoutMs?: number; // по умолчанию 30000
}

type Body = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

const CLOSED: DbError = { code: SANDBOX_CRASHED, message: 'Песочница закрыта' };

export async function createRpcClient(port: RpcPort, opts: RpcOptions = {}): Promise<DbClient> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  let nextId = 1;
  let death: DbError | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let current: {
    id: number;
    resolve(v: unknown): void;
    reject(e: unknown): void;
    timer?: ReturnType<typeof setTimeout>;
  } | null = null;

  // Клиент умирает один раз: текущий запрос и вся очередь отклоняются с причиной смерти
  function die(err: DbError): void | Promise<void> {
    if (death) return;
    death = err;
    if (current) {
      clearTimeout(current.timer);
      current.reject(new DbException(err));
      current = null;
    }
    return port.terminate();
  }

  port.onMessage((res) => {
    if (!current || res.id !== current.id) return;
    const c = current;
    current = null;
    clearTimeout(c.timer);
    if (res.ok) c.resolve(res.value);
    else c.reject(new DbException(res.error));
  });
  port.onError(() => void die({ code: SANDBOX_CRASHED, message: 'Worker песочницы упал' }));

  // Очередь: следующий запрос уходит только после ответа на предыдущий
  function send<T>(body: Body, ms = timeoutMs): Promise<T> {
    if (death) return Promise.reject(new DbException(CLOSED));
    const run = () =>
      new Promise<T>((resolve, reject) => {
        if (death) return reject(new DbException(death));
        const id = nextId++;
        const timer =
          ms > 0
            ? setTimeout(
                () => void die({ code: SANDBOX_TIMEOUT, message: `Запрос выполнялся дольше ${ms / 1000} с` }),
                ms,
              )
            : undefined;
        current = { id, resolve: resolve as (v: unknown) => void, reject, timer };
        port.post({ ...body, id } as WorkerRequest);
      });
    const p = tail.then(run);
    tail = p.catch(() => {});
    return p;
  }

  try {
    await send({ type: 'init', dataDir: opts.dataDir }, opts.initTimeoutMs ?? 30000);
  } catch (e) {
    await die(CLOSED);
    throw e;
  }

  return {
    query: (sql, params) => send<QueryResult>({ type: 'query', sql, params }),
    exec: (sql) => send<QueryResult[]>({ type: 'exec', sql }),
    dump: () => send<Blob>({ type: 'dump' }),
    version: () => send<string>({ type: 'version' }),
    close: async () => {
      await die(CLOSED);
    },
  };
}
