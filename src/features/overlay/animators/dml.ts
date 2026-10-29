import { rem } from '@/features/board/layout';
import { currentTable, rebuildTable, withTable } from '../frame';
import type { Animator, Decoration, GhostRow, GhostTable, Phase, StageOf } from '../types';

function targetBase(
  current: GhostTable | null,
  stage: StageOf<'dml'>,
  ctx: Parameters<Animator>[3],
): Pick<GhostTable, 'id' | 'title' | 'x' | 'y' | 'fold'> {
  if (current && !current.dashed) return current;
  const rect = ctx.nodeRect(stage.tableId);
  return {
    id: `t:${stage.tableId}`,
    title: stage.tableId.split('.').at(-1) ?? stage.tableId,
    x: rect?.x ?? ctx.workArea.x,
    y: rect?.y ?? ctx.workArea.y,
    fold: ctx.folded(stage.tableId),
  };
}

function visibleValues(table: GhostTable, values: unknown[]) {
  return table.shown ? table.shown.map((index) => values[index]) : values;
}

function incomingTable(
  stage: StageOf<'dml'>,
  stageIndex: number,
  ctx: Parameters<Animator>[3],
): GhostTable | null {
  if (!stage.source) return null;
  const table = rebuildTable(
    { id: `i:${stageIndex}`, title: 'INSERT', x: ctx.workArea.x, y: ctx.workArea.y },
    stage.source,
  );
  return { ...table, rows: table.rows.map((row) => ({ ...row, state: 'new' as const })) };
}

function branchMark(branch: StageOf<'dml'>['mergeBranches'][string]): Partial<GhostRow> {
  if (branch === 'matched_update') return { state: 'matched', badge: 'UPDATE' };
  if (branch === 'matched_delete') return { state: 'deleted', badge: 'DELETE' };
  if (branch === 'not_matched_insert') return { state: 'new', badge: 'INSERT' };
  if (branch === 'skipped') return { state: 'unknown', badge: 'ПРОПУСК' };
  return {};
}

function conflictLines(source: GhostTable | null, target: GhostTable, stage: StageOf<'dml'>): Decoration[] {
  if (!source) return [];
  return stage.conflicts.flatMap((conflict, index) => {
    const from = source.rows[index];
    const to = target.rows.find((row) => row.key === conflict.key);
    if (!from || !to) return [];
    return [
      {
        kind: 'pair-line' as const,
        id: `conflict:${from.key}:${to.key}`,
        from: { table: source.id, row: from.key, col: source.columns[0]?.name ?? '' },
        to: { table: target.id, row: to.key, col: target.columns[0]?.name ?? '' },
      },
    ];
  });
}

function cascadePhases(
  phase: Phase,
  stage: StageOf<'dml'>,
  stageIndex: number,
  ctx: Parameters<Animator>[3],
): Phase[] {
  const from = ctx.nodeRect(stage.tableId);
  if (!from) return [];
  return stage.cascades.flatMap((cascade, index) => {
    const to = ctx.nodeRect(cascade.tableId);
    if (!to) return [];
    return [
      {
        id: `${stageIndex}:cascade:${index}`,
        stageIndex,
        caption: `Каскад затрагивает ${cascade.tableId.split('.').at(-1) ?? cascade.tableId}`,
        durationMs: 450,
        frame: {
          ...phase.frame,
          decorations: [
            ...phase.frame.decorations,
            {
              kind: 'arrow',
              id: `cascade:${stage.tableId}:${cascade.tableId}`,
              from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
              to: { x: to.x + to.width / 2, y: to.y + to.height / 2 },
              tone: 'info',
            },
          ],
        },
      },
    ];
  });
}

export const dmlAnimator: Animator<StageOf<'dml'>> = (prev, stage, stageIndex, ctx) => {
  const current = currentTable(prev);
  const base = targetBase(current, stage, ctx);
  const inserted = new Set(stage.inserted);
  const deleted = new Set(stage.deleted);
  const updated = new Map(stage.updated.map((item) => [item.key, item]));
  const conflicts = new Map(stage.conflicts.map((item) => [item.key, item]));
  const table = rebuildTable(base, stage.output);
  const marked = {
    ...table,
    rows: table.rows.map((row) => {
      const change = updated.get(row.key);
      const defaultMarks = inserted.has(row.key)
        ? Object.fromEntries(
            (stage.defaulted ?? [])
              .map((name) => table.columns.findIndex((column) => column.name === name))
              .filter((index) => index >= 0)
              .map((index) => [index, 'default' as const]),
          )
        : undefined;
      const changedMarks = change
        ? Object.fromEntries(
            change.changedColumns
              .map((name) => table.columns.findIndex((column) => column.name === name))
              .filter((index) => index >= 0)
              .map((index) => [index, 'changed' as const]),
          )
        : undefined;
      const branch = branchMark(stage.mergeBranches[row.key]);
      const conflict = conflicts.get(row.key);
      return {
        ...row,
        ...(stage.op === 'truncate' && deleted.has(row.key)
          ? { state: 'cut' as const }
          : deleted.has(row.key)
            ? { state: 'deleted' as const }
            : inserted.has(row.key)
              ? { state: 'new' as const }
              : change
                ? { state: 'changed' as const }
                : {}),
        ...branch,
        ...(conflict?.action === 'nothing' ? { state: 'matched' as const, badge: 'CONFLICT: ПРОПУСК' } : {}),
        ...(conflict?.action === 'update' ? { badge: 'CONFLICT: UPDATE' } : {}),
        ...(changedMarks && Object.keys(changedMarks).length
          ? { cellMarks: changedMarks }
          : defaultMarks && Object.keys(defaultMarks).length
            ? { cellMarks: defaultMarks }
            : {}),
      };
    }),
  };
  const incoming = current?.dashed ? current : incomingTable(stage, stageIndex, ctx);
  const decorations = conflictLines(incoming, marked, stage);
  const targetFrame = withTable({ ...prev, decorations }, marked);
  const sourceFrame = incoming && incoming !== current ? withTable(targetFrame, incoming) : targetFrame;
  const movedIncoming = incoming
    ? {
        ...incoming,
        x: stage.conflicts.length ? marked.x - rem(1.5) : marked.x,
        y: marked.y,
        opacity: stage.conflicts.length ? 0.65 : 0,
      }
    : null;
  const frame = movedIncoming ? withTable(targetFrame, movedIncoming) : targetFrame;
  const final: Phase = {
    id: `${stageIndex}:dml`,
    stageIndex,
    caption: stage.caption,
    durationMs: 650,
    frame,
  };
  const before = stage.updated.length
    ? {
        ...marked,
        rows: marked.rows.map((row) => {
          const change = updated.get(row.key);
          return change
            ? { ...row, values: visibleValues(marked, change.before), state: 'matched' as const }
            : row;
        }),
      }
    : null;
  const phases = before
    ? [
        {
          id: `${stageIndex}:update-before`,
          stageIndex,
          caption: `${stage.caption}: старые значения`,
          durationMs: 450,
          frame: movedIncoming
            ? withTable(withTable({ ...prev, decorations }, before), movedIncoming)
            : withTable({ ...prev, decorations }, before),
        },
        final,
      ]
    : [final];
  if (incoming && incoming !== current)
    phases.unshift({
      id: `${stageIndex}:conflict-source`,
      stageIndex,
      caption: `${stage.caption}: строка ищет конфликт`,
      durationMs: 450,
      frame: sourceFrame,
    });
  return [...phases, ...cascadePhases(final, stage, stageIndex, ctx)];
};
