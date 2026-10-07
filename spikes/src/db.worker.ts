// Спайк-воркер: голый PGlite и простейший RPC
import { PGlite } from '@electric-sql/pglite';

let pg: PGlite | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type, sql, dataDir } = e.data as { id: number; type: string; sql?: string; dataDir?: Blob };
  try {
    if (type === 'init') {
      const t = performance.now();
      pg = new PGlite(dataDir ? { loadDataDir: dataDir } : {});
      await pg.waitReady;
      postMessage({ id, ok: true, value: Math.round(performance.now() - t) });
    } else if (type === 'exec') {
      await pg!.exec(sql!);
      postMessage({ id, ok: true, value: null });
    } else if (type === 'query') {
      const r = await pg!.query(sql!, [], { rowMode: 'array' });
      postMessage({ id, ok: true, value: r.rows });
    } else if (type === 'dump') {
      const blob = await pg!.dumpDataDir('gzip');
      postMessage({ id, ok: true, value: blob });
    }
  } catch (err) {
    const x = err as { code?: string; message: string };
    postMessage({ id, ok: false, error: { code: x.code, message: x.message } });
  }
};
