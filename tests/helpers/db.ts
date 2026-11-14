import { type DatasetId, loadDatasetSql } from '@/features/db/datasets';
import { createNodeClient } from '@/features/db/node-client';
import type { DbClient } from '@/features/db/types';
import type { Locale } from '@/lib/i18n';

const dumps = new Map<string, Promise<Blob>>();

// Снапшот датасета строится один раз на процесс: exec SQL → dump
export function datasetDump(id: DatasetId, locale: Locale = 'ru'): Promise<Blob> {
  const key = `${locale}:${id}`;
  let dump = dumps.get(key);
  if (!dump) {
    dump = (async () => {
      const db = await createNodeClient();
      try {
        await db.exec(await loadDatasetSql(id, locale));
        return await db.dump();
      } finally {
        await db.close();
      }
    })();
    dumps.set(key, dump);
  }
  return dump;
}

export async function withDataset<T>(
  id: DatasetId,
  fn: (db: DbClient) => Promise<T>,
  locale: Locale = 'ru',
): Promise<T> {
  const db = await createNodeClient({ dataDir: await datasetDump(id, locale) });
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
