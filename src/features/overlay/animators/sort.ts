import { keyList } from '@/features/tracer/captions';
import {
  clearMarks,
  currentTable,
  mapColumns,
  rebuildTable,
  shownIndices,
  stageRows,
  withTable,
} from '../frame';
import type { Animator, GhostTable, StageOf } from '../types';
import { genericAnimator } from './generic';

// ORDER BY: ключ подсвечивается, строки переезжают на новые места
export const sortAnimator: Animator<StageOf<'sort'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  // Колонки ключа по номерам от трассировщика: order by 2, b.price, lower(title)
  const markKeys = (t: GhostTable) => {
    const keyCols = shownIndices(t, stage.keyColumns);
    return mapColumns(t, (_, i) => ({ state: keyCols.includes(i) ? 'key' : 'normal' }));
  };
  const keys = markKeys(clearMarks(cur));
  const reordered = markKeys(rebuildTable(cur, stage.output, stage.order, stageRows(stage)));
  const reorderPhase = {
    id: `${stageIndex}:reorder`,
    stageIndex,
    caption: stage.caption,
    durationMs: 900,
    frame: { tables: withTable(prev, reordered).tables, decorations: [] },
  };
  // Сжатый режим Ф5: порядка строк нет, только итог
  if (stage.compressed) return [reorderPhase];
  return [
    {
      id: `${stageIndex}:keys`,
      stageIndex,
      caption: `ORDER BY: сортируем по ${keyList(stage.sortKeys)}`,
      durationMs: 400,
      frame: { tables: withTable(prev, keys).tables, decorations: [] },
    },
    reorderPhase,
  ];
};
