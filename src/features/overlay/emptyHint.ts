import type { Trace } from '@/features/tracer/types';
import type { Locale } from '@/lib/i18n';
import { stageRows } from './frame';
import { stageLabel, tableTitle } from './labels';

// Если результат пустой, говорим, на какой стадии пропали строки
export function emptyResultHint(trace: Trace, locale: Locale = 'ru'): string | null {
  if (trace.mode !== 'full' || !trace.result || trace.result.rows.length > 0) return null;
  let prev: number | null = null;
  for (const stage of trace.stages) {
    const n = stageRows(stage);
    if (n === 0) {
      if (prev === null && stage.kind === 'scan') {
        if (locale === 'en')
          return `Table ${tableTitle(stage.tableId, stage.alias)} was empty from the start.`;
        return `В таблице ${tableTitle(stage.tableId, stage.alias)} нет строк: пусто с самого начала.`;
      }
      if (locale === 'en')
        return `Rows disappeared at ${stageLabel(stage, locale)}: ${prev ?? 0} before, 0 after.`;
      return `Строки пропали на шаге ${stageLabel(stage, locale)}: было ${prev ?? 0}, стало 0.`;
    }
    prev = n;
  }
  return null;
}
