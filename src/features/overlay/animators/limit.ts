import {
  clearMarks,
  counterNear,
  currentTable,
  mapRows,
  rebuildTable,
  stageRows,
  totalRows,
  withTable,
} from '../frame';
import type { Animator, Decoration, StageOf } from '../types';
import { genericAnimator } from './generic';

// LIMIT / OFFSET: линии-ножницы, строки за ними гаснут и уходят
export const limitAnimator: Animator<StageOf<'limit'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const before = totalRows(cur);
  const kept = new Set(stage.kept);
  const marked = mapRows(clearMarks(cur), (r) => (kept.has(r.key) ? {} : { state: 'cut' as const }));

  // Ножницы по настоящим местам оставленных строк: WITH TIES тянет окно дальше limit,
  // без ORDER BY окно идёт по порядку эталона. Не подряд или не видны → только состояние cut
  const scissors: Decoration[] = [];
  const idx = marked.rows.flatMap((r, i) => (kept.has(r.key) ? [i] : []));
  if (idx.length && idx[idx.length - 1] - idx[0] + 1 === idx.length) {
    if (idx[0] > 0) scissors.push({ kind: 'scissors', table: cur.id, afterRow: idx[0] - 1 });
    const last = idx[idx.length - 1];
    if (last < marked.rows.length - 1) scissors.push({ kind: 'scissors', table: cur.id, afterRow: last });
  }

  const after = stageRows(stage);
  const result = rebuildTable(cur, stage.output, undefined, after);
  const head = [
    stage.limit !== null ? `LIMIT ${stage.limit}` : null,
    stage.offset > 0 ? `OFFSET ${stage.offset}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const cutPhase = {
    id: `${stageIndex}:cut`,
    stageIndex,
    caption: stage.caption,
    durationMs: 600,
    frame: {
      tables: withTable(prev, result).tables,
      decorations: [counterNear(result, `${stageIndex}:counter`, `${before} → ${after}`)],
    },
  };
  // Сжатый режим Ф5: строк нет, только итог и счётчик
  if (stage.compressed) return [cutPhase];
  return [
    {
      id: `${stageIndex}:scissors`,
      stageIndex,
      caption: `${head}: отрезаем лишнее`,
      durationMs: 600,
      frame: { tables: withTable(prev, marked).tables, decorations: scissors },
    },
    cutPhase,
  ];
};
