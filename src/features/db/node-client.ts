import { createRpcClient } from './client';
import { createRequestHandler } from './handler';
import type { WorkerResponse } from './protocol';
import type { DbClient } from './types';

// Тот же протокол, но PGlite в текущем процессе. Таймаута нет: wasm блокирует поток, сторож всё равно не сработает
export function createNodeClient(opts: { dataDir?: Blob } = {}): Promise<DbClient> {
  const handler = createRequestHandler();
  let listener: (res: WorkerResponse) => void = () => {};
  return createRpcClient(
    {
      post: (req) => void handler.handle(req).then((res) => listener(res)),
      onMessage: (cb) => {
        listener = cb;
      },
      onError: () => {},
      terminate: () => handler.close(),
    },
    { dataDir: opts.dataDir, timeoutMs: 0, initTimeoutMs: 0 },
  );
}
