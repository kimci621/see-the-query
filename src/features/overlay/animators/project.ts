import { clearMarks, currentTable, mapColumns, rebuildTable, stageRows, withTable } from '../frame';
import type { Animator, GhostColumn, StageOf } from '../types';
import { genericAnimator } from './generic';

// SELECT: лишние колонки гаснут и схлопываются, вычисляемые «вырастают» справа
export const projectAnimator: Animator<StageOf<'project'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);

  const base = mapColumns(clearMarks(cur), (c) => {
    if (stage.removed.includes(c.name)) return { state: 'removed' };
    if (c.name in stage.renamed) return { state: 'highlight' };
    return { state: 'normal' };
  });

  // значения вычисляемых колонок берём из выхода стадии по ключу строки
  const outIndex = stage.computed.map((name) => stage.output.columns.findIndex((c) => c.name === name));
  const outByKey = new Map(stage.output.rows.map((r) => [r.key, r.values]));
  const computedCols: GhostColumn[] = stage.computed.map((name, i) => ({
    name,
    type: stage.output.columns[outIndex[i]]?.type,
    state: 'computed',
  }));
  const marked = {
    ...base,
    columns: [...base.columns, ...computedCols],
    rows: base.rows.map((r) => ({
      ...r,
      values: [
        ...r.values,
        ...outIndex.map((ci) => (ci === -1 ? null : (outByKey.get(r.key)?.[ci] ?? null))),
      ],
    })),
  };

  const collapsed = mapColumns(rebuildTable(cur, stage.output, undefined, stageRows(stage)), (c) => ({
    state: stage.computed.includes(c.name) ? 'computed' : 'normal',
  }));

  const parts: string[] = [`оставляем ${stage.kept.length + stage.computed.length}`];
  if (stage.removed.length) parts.push(`убираем ${stage.removed.join(', ')}`);
  if (stage.computed.length) parts.push(`вычисляем ${stage.computed.join(', ')}`);
  const renames = Object.entries(stage.renamed).map(([from, to]) => `${from} → ${to}`);
  if (renames.length) parts.push(`переименовываем ${renames.join(', ')}`);

  return [
    {
      id: `${stageIndex}:mark`,
      stageIndex,
      caption: `SELECT: ${parts.join(', ')}`,
      durationMs: 600,
      frame: { tables: withTable(prev, marked).tables, decorations: [] },
    },
    {
      id: `${stageIndex}:collapse`,
      stageIndex,
      caption: stage.caption,
      durationMs: 700,
      frame: { tables: withTable(prev, collapsed).tables, decorations: [] },
    },
  ];
};
