export type DatasetId = 'bookstore' | 'empty' | 'events' | 'big_bookstore';

// Vite и Vitest оба понимают import.meta.glob, поэтому отдельная ветка с readFile не нужна
const files = import.meta.glob<string>('/content/datasets/*.sql', { query: '?raw', import: 'default' });

// Датасет-надстройка: файл добавляет таблицы к базовому датасету.
// events нужны заказы bookstore, дублировать их в файле нельзя.
const BASES: Partial<Record<DatasetId, DatasetId>> = { events: 'bookstore' };

export async function loadDatasetSql(id: DatasetId): Promise<string> {
  const load = files[`/content/datasets/${id}.sql`];
  if (!load) throw new Error(`Датасет ${id} не найден в content/datasets`);
  const base = BASES[id] ? await loadDatasetSql(BASES[id]) : '';
  return base + (await load());
}
