import { currentTable, rebuildTable, withTable } from '../frame';
import type { Animator, GhostTable, StageOf } from '../types';

export const dmlAnimator: Animator<StageOf<'dml'>> = (prev, stage, stageIndex, ctx) => {
  const current = currentTable(prev);
  const rect = ctx.nodeRect(stage.tableId);
  const base: Pick<GhostTable, 'id' | 'title' | 'x' | 'y' | 'fold'> = current ?? {
    id: `t:${stage.tableId}`,
    title: stage.tableId.split('.').at(-1) ?? stage.tableId,
    x: rect?.x ?? ctx.workArea.x,
    y: rect?.y ?? ctx.workArea.y,
    fold: ctx.folded(stage.tableId),
  };
  const inserted = new Set(stage.inserted);
  const deleted = new Set(stage.deleted);
  const updated = new Map(stage.updated.map((item) => [item.key, item]));
  const table = rebuildTable(base, stage.output);
  const marked = {
    ...table,
    rows: table.rows.map((row) => {
      const change = updated.get(row.key);
      const cellMarks = change
        ? Object.fromEntries(
            change.changedColumns
              .map((name) => table.columns.findIndex((column) => column.name === name))
              .filter((index) => index >= 0)
              .map((index) => [index, 'changed' as const]),
          )
        : inserted.has(row.key)
          ? Object.fromEntries(
              (stage.defaulted ?? [])
                .map((name) => table.columns.findIndex((column) => column.name === name))
                .filter((index) => index >= 0)
                .map((index) => [index, 'default' as const]),
            )
          : undefined;
      return {
        ...row,
        state: deleted.has(row.key)
          ? ('deleted' as const)
          : inserted.has(row.key)
            ? ('new' as const)
            : change
              ? ('changed' as const)
              : row.state,
        ...(cellMarks && Object.keys(cellMarks).length ? { cellMarks } : {}),
      };
    }),
  };
  return [
    {
      id: `${stageIndex}:dml`,
      stageIndex,
      caption: stage.caption,
      durationMs: 650,
      frame: withTable({ ...prev, decorations: [] }, marked),
    },
  ];
};
