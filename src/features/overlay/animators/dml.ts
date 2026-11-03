import { rem } from '@/features/board/layout';
import type { Relation } from '@/features/tracer/types';
import { currentTable, mapRows, rebuildTable, withTable } from '../frame';
import { cellLeft, ghostHeight, ghostWidth, TABLE_GAP } from '../geometry';
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

// Призрак зависимой таблицы из снимка схемы: каскад помечает затронутые строки.
function cascadeGhost(
  tableId: string,
  affected: StageOf<'dml'>['cascades'][number],
  at: { x: number; y: number },
  ctx: Parameters<Animator>[3],
): GhostTable | null {
  const table = ctx.schema.tables.find((item) => item.id === tableId);
  if (!table) return null;
  const deleted = new Set(affected.deleted);
  const updated = new Map(affected.updated.map((item) => [item.key, item.values]));
  const relation: Relation = {
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      source: { alias: table.name, column: column.name },
    })),
    rows: table.sampleRows.map((values, index) => ({
      key: `${table.name}=${table.sampleCtids[index]}`,
      lineage: { [table.name]: table.sampleCtids[index] },
      values,
    })),
  };
  const ghost = rebuildTable(
    {
      id: `t:${table.id}`,
      title: table.name,
      x: at.x,
      y: at.y,
      fold: ctx.folded(table.id),
    },
    relation,
    undefined,
    table.rowCount,
  );
  return mapRows(ghost, (row) => {
    if (deleted.has(row.key)) return { state: 'deleted' as const };
    const values = updated.get(row.key);
    return values ? { state: 'changed' as const, values: visibleValues(ghost, values) } : {};
  });
}

// Волна каскада: призраки зависимых таблиц встают в сетку справа от цели и остаются в кадре.
// Позиции нод доски не годятся: связанные таблицы часто стоят далеко, и обе не читаются на зуме.
function cascadePhases(
  phase: Phase,
  stage: StageOf<'dml'>,
  stageIndex: number,
  ctx: Parameters<Animator>[3],
): Phase[] {
  const first = currentTable(phase.frame);
  if (!first) return [];
  const ghosts = stage.cascades.flatMap((cascade) => {
    const ghost = cascadeGhost(cascade.tableId, cascade, { x: 0, y: 0 }, ctx);
    return ghost ? [{ cascade, ghost }] : [];
  });
  if (!ghosts.length) return [];
  // Два призрака в ряд: длинная цепочка не растягивает кадр в нечитаемую полосу
  const all = [first, ...ghosts.map((item) => item.ghost)];
  const columnWidth = Math.max(...all.map(ghostWidth)) + TABLE_GAP;
  const placed: GhostTable[] = [];
  let y = first.y;
  for (let row = 0; row * 2 < all.length; row++) {
    let height = 0;
    for (let column = 0; column < 2; column++) {
      const table = all[row * 2 + column];
      if (!table) continue;
      placed[row * 2 + column] = { ...table, x: first.x + column * columnWidth, y };
      height = Math.max(height, ghostHeight(table));
    }
    y += height + TABLE_GAP;
  }
  let frame = phase.frame;
  const phases: Phase[] = [];
  ghosts.forEach(({ cascade }, index) => {
    const previous = placed[index];
    const ghost = placed[index + 1];
    if (!previous || !ghost) return;
    const name = cascade.tableId.split('.').at(-1) ?? cascade.tableId;
    const caption =
      cascade.updated.length === 0
        ? `Каскад удаляет строки ${name}: ${cascade.deleted.length}`
        : `Каскад меняет ${name}: удалено ${cascade.deleted.length}, изменено ${cascade.updated.length}`;
    frame = {
      ...frame,
      decorations: [
        ...frame.decorations,
        {
          kind: 'arrow',
          id: `cascade:${previous.id}:${ghost.id}`,
          from: { x: previous.x + ghostWidth(previous), y: previous.y + rem(1.5) },
          to: { x: ghost.x, y: ghost.y + rem(1.5) },
          tone: 'info',
        },
      ],
    };
    frame = withTable(frame, ghost);
    phases.push({
      id: `${stageIndex}:cascade:${index}`,
      stageIndex,
      caption,
      durationMs: 450,
      frame,
    });
  });
  return phases;
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
  if (stage.sequences?.length) {
    const counters = (after: boolean): Decoration[] =>
      (stage.sequences ?? []).map((sequence, index) => ({
        kind: 'counter',
        id: `${stageIndex}:sequence:${index}`,
        x:
          marked.x +
          cellLeft(
            marked,
            Math.max(
              0,
              marked.columns.findIndex((column) => column.name === sequence.column),
            ),
          ),
        y: marked.y - rem(2 * (index + 1)),
        text: `${sequence.column}: ${sequence.before ?? 'не использована'}${after ? ` → ${sequence.after ?? 'не использована'}` : ''}`,
      }));
    const initial = { ...marked, rows: marked.rows.filter((row) => !inserted.has(row.key)) };
    phases.unshift({
      id: `${stageIndex}:sequence-before`,
      stageIndex,
      caption: stage.caption,
      durationMs: 450,
      frame: withTable({ ...prev, decorations: [...decorations, ...counters(false)] }, initial),
    });
    final.frame = { ...final.frame, decorations: [...final.frame.decorations, ...counters(true)] };
  }
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
