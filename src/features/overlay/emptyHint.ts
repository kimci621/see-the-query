import type { Trace } from '@/features/tracer/types';
import { stageRows } from './frame';
import { stageLabel, tableTitle } from './labels';

// Если результат пустой, говорим, на какой стадии пропали строки
export function emptyResultHint(trace: Trace): string | null {
  if (trace.mode !== 'full' || !trace.result || trace.result.rows.length > 0) return null;
  let prev: number | null = null;
  for (const stage of trace.stages) {
    const n = stageRows(stage);
    if (n === 0) {
      if (prev === null && stage.kind === 'scan') {
        return `В таблице ${tableTitle(stage.tableId, stage.alias)} нет строк: пусто с самого начала.`;
      }
      return `Строки пропали на шаге ${stageLabel(stage)}: было ${prev ?? 0}, стало 0.`;
    }
    prev = n;
  }
  return null;
}
