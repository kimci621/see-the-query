import { createRequestHandler } from './handler';
import type { WorkerRequest } from './protocol';

const handler = createRequestHandler();

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  self.postMessage(await handler.handle(e.data));
};
