export type DatasetId = 'bookstore' | 'empty' | 'events' | 'big_bookstore';

// Vite и Vitest оба понимают import.meta.glob, поэтому отдельная ветка с readFile не нужна
const files = import.meta.glob<string>('/content/datasets/*.sql', { query: '?raw', import: 'default' });
const englishFiles = import.meta.glob<string>('/content/datasets/en/*.sql', {
  query: '?raw',
  import: 'default',
});

// Датасет-надстройка: файл добавляет таблицы к базовому датасету.
// events нужны заказы bookstore, дублировать их в файле нельзя.
const BASES: Partial<Record<DatasetId, DatasetId>> = { events: 'bookstore' };

export async function loadDatasetSql(id: DatasetId, locale: Locale = 'ru'): Promise<string> {
  const load =
    locale === 'en' && (id === 'bookstore' || id === 'big_bookstore')
      ? englishFiles[`/content/datasets/en/${id}.sql`]
      : files[`/content/datasets/${id}.sql`];
  if (!load) throw new Error(`Датасет ${id} не найден в content/datasets`);
  const base = BASES[id] ? await loadDatasetSql(BASES[id], locale) : '';
  return base + (await load());
}

import type { Locale } from '@/lib/i18n';
