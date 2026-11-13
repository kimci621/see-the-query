import type { TableInfo } from '@/features/db/introspect';
import type { Locale } from '@/lib/i18n';
import { plural } from '@/lib/plural';

export const COMPRESS_AFTER = 1000;
export const COMPRESSED_ROWS = 5;

export function isCompressed(table: TableInfo): boolean {
  return table.rowCount > COMPRESS_AFTER;
}

export function hiddenRowsLabel(table: TableInfo, locale: Locale = 'ru'): string {
  const hidden = table.rowCount - Math.min(COMPRESSED_ROWS, table.sampleRows.length);
  if (locale === 'en')
    return `${new Intl.NumberFormat('en-US').format(hidden)} more ${hidden === 1 ? 'row' : 'rows'}`;
  return `ещё ${new Intl.NumberFormat('ru-RU').format(hidden)} ${plural(hidden, 'строка', 'строки', 'строк')}`;
}
