export type DatasetId = 'bookstore' | 'empty' | 'events' | 'big_bookstore';

// Vite и Vitest оба понимают import.meta.glob, поэтому отдельная ветка с readFile не нужна
const files = import.meta.glob<string>('/content/datasets/*.sql', { query: '?raw', import: 'default' });

export function loadDatasetSql(id: DatasetId): Promise<string> {
  const load = files[`/content/datasets/${id}.sql`];
  if (!load) return Promise.reject(new Error(`Датасет ${id} не найден в content/datasets`));
  return load();
}
