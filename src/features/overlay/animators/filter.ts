import {
  clearMarks,
  counterNear,
  currentTable,
  mapColumns,
  mapRows,
  rebuildTable,
  stageRows,
  totalRows,
  withTable,
} from '../frame';
import type { Animator, RowState, StageOf } from '../types';
import { genericAnimator } from './generic';

// WHERE / HAVING: сканер проходит строки, каждая получает вердикт, отсеянные уходят
export const filterAnimator: Animator<StageOf<'filter'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clause = stage.clause === 'where' ? 'WHERE' : 'HAVING';
  const before = totalRows(cur);
  const after = stageRows(stage);
  const result = rebuildTable(cur, stage.output, undefined, after);
  const drop = {
    tables: withTable(prev, result).tables,
    decorations: [counterNear(result, `${stageIndex}:counter`, `${before} → ${after}`)],
  };
  const dropPhase = {
    id: `${stageIndex}:drop`,
    stageIndex,
    caption: stage.caption,
    durationMs: 600,
    frame: drop,
  };
  // Сжатый режим Ф5: вердиктов нет, только итог и счётчик
  if (stage.compressed) return [dropPhase];

  const marked = mapColumns(clearMarks(cur), (c) => ({
    state: stage.predicateColumns.includes(c.name) ? 'highlight' : 'normal',
  }));
  const check = {
    tables: withTable(prev, marked).tables,
    decorations: [{ kind: 'scanner' as const, table: cur.id, rowIndex: 0 }],
  };

  let unknown = 0;
  const judged = mapRows(marked, (r) => {
    const v = stage.verdicts[r.key];
    if (v === null) {
      unknown += 1;
      return { state: 'unknown' as RowState, badge: 'UNKNOWN' };
    }
    if (v === false) return { state: 'dropped' as RowState };
    if (v === true) return { state: 'kept' as RowState };
    return {};
  });
  const verdicts = {
    tables: withTable(prev, judged).tables,
    decorations: [{ kind: 'scanner' as const, table: cur.id, rowIndex: Math.max(0, judged.rows.length - 1) }],
  };

  const verdictCaption =
    unknown > 0
      ? `${clause}: зелёные прошли, красные нет, серые дали UNKNOWN и тоже уходят`
      : `${clause}: зелёные прошли условие, красные нет`;

  return [
    {
      id: `${stageIndex}:check`,
      stageIndex,
      // HAVING судит свёрнутые группы, не строки таблицы
      caption: `${clause}: проверяем условие для каждой ${stage.clause === 'where' ? 'строки' : 'группы'}`,
      durationMs: 500,
      frame: check,
    },
    { id: `${stageIndex}:verdicts`, stageIndex, caption: verdictCaption, durationMs: 900, frame: verdicts },
    dropPhase,
  ];
};
