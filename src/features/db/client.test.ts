import { describe, expect, it, vi } from 'vitest';
import { createRpcClient, type RpcPort } from './client';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { type DbException, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from './types';

// Подменный транспорт: тест сам решает, когда и что ответить
function fakePort() {
  const sent: WorkerRequest[] = [];
  let reply: (res: WorkerResponse) => void = () => {};
  let fail: () => void = () => {};
  const port: RpcPort = {
    post: (req) => void sent.push(req),
    onMessage: (cb) => {
      reply = cb;
    },
    onError: (cb) => {
      fail = cb;
    },
    terminate: vi.fn(),
  };
  const last = () => sent[sent.length - 1].id;
  const answer = (value: unknown) => reply({ id: last(), ok: true, value });
  const reject = (code: string) => reply({ id: last(), ok: false, error: { code, message: code } });
  return { port, sent, answer, reject, crash: () => fail() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: DbException) => e.db.code,
  );

async function connected(timeoutMs = 50) {
  const f = fakePort();
  const pending = createRpcClient(f.port, { timeoutMs });
  await tick();
  f.answer(null); // init
  return { ...f, client: await pending };
}

describe('createRpcClient', () => {
  it('шлёт запросы строго по одному', async () => {
    const { client, sent, answer } = await connected();
    const a = client.query('select 1');
    const b = client.query('select 2');
    await tick();
    expect(sent.map((r) => r.type)).toEqual(['init', 'query']);
    answer({ fields: [], rows: [[1]] });
    await expect(a).resolves.toMatchObject({ rows: [[1]] });
    await tick();
    expect(sent).toHaveLength(3);
    answer({ fields: [], rows: [[2]] });
    await expect(b).resolves.toMatchObject({ rows: [[2]] });
  });

  it('ошибка ответа превращается в DbException с кодом', async () => {
    const { client, reject } = await connected();
    const p = code(client.query('select nme from book'));
    await tick();
    reject('42703');
    expect(await p).toBe('42703');
  });

  it('по таймауту: terminate, текущий и очередь → VS001, новые вызовы → VS002', async () => {
    const { client, port } = await connected(30);
    const hung = code(client.query('select pg_sleep(10)'));
    const queued = code(client.query('select 1'));
    expect(await hung).toBe(SANDBOX_TIMEOUT);
    expect(await queued).toBe(SANDBOX_TIMEOUT);
    expect(port.terminate).toHaveBeenCalledTimes(1);
    expect(await code(client.query('select 1'))).toBe(SANDBOX_CRASHED);
  });

  it('загрузка и снимок получают 30 секунд, обычный запрос остаётся под лимитом 3 секунды', async () => {
    vi.useFakeTimers();
    try {
      const f = fakePort();
      const pending = createRpcClient(f.port);
      await vi.advanceTimersByTimeAsync(0);
      f.answer(null);
      const client = await pending;

      const loading = client.exec('загрузка датасета', { initialization: true });
      await vi.advanceTimersByTimeAsync(3001);
      expect(f.port.terminate).not.toHaveBeenCalled();
      f.answer([]);
      await expect(loading).resolves.toEqual([]);

      const dump = client.dump();
      await vi.advanceTimersByTimeAsync(3001);
      expect(f.port.terminate).not.toHaveBeenCalled();
      const snapshot = new Blob(['snapshot']);
      f.answer(snapshot);
      await expect(dump).resolves.toBe(snapshot);

      const query = code(client.query('select pg_sleep(10)'));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await query).toBe(SANDBOX_TIMEOUT);
      expect(f.port.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('обычный exec тоже прерывается через 3 секунды', async () => {
    vi.useFakeTimers();
    try {
      const f = fakePort();
      const pending = createRpcClient(f.port);
      await vi.advanceTimersByTimeAsync(0);
      f.answer(null);
      const client = await pending;
      const result = code(client.exec('select pg_sleep(10)'));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBe(SANDBOX_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('настройка таймаута инициализации действует на загрузку и снимок', async () => {
    vi.useFakeTimers();
    try {
      const f = fakePort();
      const pending = createRpcClient(f.port, { timeoutMs: 10, initTimeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(0);
      f.answer(null);
      const client = await pending;
      const loading = client.exec('загрузка датасета', { initialization: true });
      await vi.advanceTimersByTimeAsync(11);
      expect(f.port.terminate).not.toHaveBeenCalled();
      f.answer([]);
      await loading;
      const snapshot = code(client.dump());
      await vi.advanceTimersByTimeAsync(99);
      expect(f.port.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await snapshot).toBe(SANDBOX_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('нулевой лимит инициализации сохраняет режим Node без сторожа', async () => {
    vi.useFakeTimers();
    try {
      const f = fakePort();
      const pending = createRpcClient(f.port, { timeoutMs: 10, initTimeoutMs: 0 });
      await vi.advanceTimersByTimeAsync(0);
      f.answer(null);
      const client = await pending;
      const loading = client.exec('загрузка датасета', { initialization: true });
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.port.terminate).not.toHaveBeenCalled();
      f.answer([]);
      await loading;
      const snapshot = client.dump();
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.port.terminate).not.toHaveBeenCalled();
      f.answer(new Blob());
      await snapshot;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['загрузка', 'снимок'])('%s прерывается после 30 секунд', async (operation) => {
    vi.useFakeTimers();
    try {
      const f = fakePort();
      const pending = createRpcClient(f.port);
      await vi.advanceTimersByTimeAsync(0);
      f.answer(null);
      const client = await pending;
      const result = code(
        operation === 'загрузка' ? client.exec('загрузка датасета', { initialization: true }) : client.dump(),
      );
      await vi.advanceTimersByTimeAsync(29999);
      expect(f.port.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(SANDBOX_TIMEOUT);
      expect(f.port.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('падение worker’а → VS002', async () => {
    const { client, crash, port } = await connected();
    const p = code(client.query('select 1'));
    await tick();
    crash();
    expect(await p).toBe(SANDBOX_CRASHED);
    expect(port.terminate).toHaveBeenCalledTimes(1);
  });
});
