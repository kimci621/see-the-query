// Спайк: время старта PGlite в worker, загрузка датасета, dump, восстановление после зависания
import datasetSql from '../../content/datasets/bookstore.sql?raw';
import { report } from './main';

type Rpc = { call: (msg: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>; worker: Worker };

function makeWorker(): Rpc {
  const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.ok ? p.resolve(e.data.value) : p.reject(e.data.error);
  };
  const call = (msg: Record<string, unknown>, timeoutMs = 3000) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject({ code: 'VS001', message: 'timeout' });
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      worker.postMessage({ id, ...msg });
    });
  return { call, worker };
}

export async function run() {
  const r: Record<string, unknown> = {};
  let w = makeWorker();
  r.initMs = await w.call({ type: 'init' }, 20000);
  let t = performance.now();
  await w.call({ type: 'exec', sql: datasetSql }, 20000);
  r.datasetMs = Math.round(performance.now() - t);
  r.version = ((await w.call({ type: 'query', sql: 'select version()' })) as string[][])[0][0];
  t = performance.now();
  const dump = (await w.call({ type: 'dump' }, 20000)) as Blob;
  r.dumpMs = Math.round(performance.now() - t);
  r.dumpKb = Math.round(dump.size / 1024);

  // Зависание: тяжёлый запрос, таймаут 3 с, terminate, новый worker из dump
  t = performance.now();
  try {
    await w.call({ type: 'query', sql: 'select count(*) from generate_series(1, 1000000000)' }, 3000);
    r.timeoutDetectedMs = 'запрос успел выполниться';
  } catch (e) {
    r.timeoutDetectedMs = Math.round(performance.now() - t);
    r.timeoutCode = (e as { code: string }).code;
  }
  w.worker.terminate();
  t = performance.now();
  w = makeWorker();
  await w.call({ type: 'init', dataDir: dump }, 20000);
  r.recoverMs = Math.round(performance.now() - t);
  r.countAfterRecover = ((await w.call({ type: 'query', sql: 'select count(*) from book' })) as number[][])[0][0];
  r.done = true;
  report(r);
}
