import { type DatasetId, loadDatasetSql } from '@/features/db/datasets';
import { createNodeClient } from '@/features/db/node-client';
import type { DbClient } from '@/features/db/types';

const dumps = new Map<DatasetId, Promise<Blob>>();

// Снапшот датасета строится один раз на процесс: exec SQL → dump
export function datasetDump(id: DatasetId): Promise<Blob> {
  let dump = dumps.get(id);
  if (!dump) {
    dump = (async () => {
      const db = await createNodeClient();
      try {
        await db.exec(await loadDatasetSql(id));
        return await db.dump();
      } finally {
        await db.close();
      }
    })();
    dumps.set(id, dump);
  }
  return dump;
}

export async function withDataset<T>(id: DatasetId, fn: (db: DbClient) => Promise<T>): Promise<T> {
  const db = await createNodeClient({ dataDir: await datasetDump(id) });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

export async function inPreview<T>(db: DbClient, fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await fn();
  } finally {
    await db.query('rollback');
  }
}
