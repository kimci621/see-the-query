import { clearMarks, currentTable, mapColumns, rebuildTable, stageRows, withTable } from '../frame';
import type { Animator, StageOf } from '../types';
import { genericAnimator } from './generic';

// ORDER BY: ключ подсвечивается, строки переезжают на новые места
export const sortAnimator: Animator<StageOf<'sort'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  // Ключи Ф5 это SQL-текст: 'price DESC NULLS LAST'; ключевые слова deparser берёт в кавычки: '"position"'
  const isKey = (name: string) =>
    [name, `"${name.replaceAll('"', '""')}"`].some((n) =>
      stage.sortKeys.some((k) => k === n || k.startsWith(`${n} `)),
    );
  const keys = mapColumns(clearMarks(cur), (c) => ({ state: isKey(c.name) ? 'key' : 'normal' }));
  const reordered = mapColumns(rebuildTable(cur, stage.output, stage.order, stageRows(stage)), (c) => ({
    state: isKey(c.name) ? 'key' : 'normal',
  }));
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
      caption: `ORDER BY: сортируем по ${stage.sortKeys.join(', ')}`,
      durationMs: 400,
      frame: { tables: withTable(prev, keys).tables, decorations: [] },
    },
    reorderPhase,
  ];
};
