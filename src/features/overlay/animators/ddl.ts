import { rem } from '@/features/board/layout';
import type { TableInfo } from '@/features/db/introspect';
import type { Relation } from '@/features/tracer/types';
import { rebuildTable } from '../frame';
import { cellLeft, ghostWidth } from '../geometry';
import type { Animator, Decoration, GhostTable, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

function ghost(table: TableInfo, ctx: Parameters<Animator>[3], shown: string[] = []): GhostTable {
  const rect = ctx.nodeRect(table.id);
  const hidden = ctx.folded(table.id).filter((name) => !shown.includes(name));
  const relation: Relation = {
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      source: { alias: table.name, column: column.name },
    })),
    rows: table.sampleRows.map((values, i) => ({
      key: `${table.name}=${table.sampleCtids[i]}`,
      lineage: { [table.name]: table.sampleCtids[i] },
      values,
    })),
  };
  return rebuildTable(
    {
      id: `t:${table.id}`,
      title: table.name,
      x: rect?.x ?? ctx.workArea.x,
      y: rect?.y ?? ctx.workArea.y,
      fold: hidden.map((name) => `${table.name}.${name}`),
    },
    relation,
    undefined,
    table.rowCount,
  );
}

export const ddlAnimator: Animator<StageOf<'ddl'>> = (prev, stage, stageIndex, ctx) => {
  const { diff } = stage;
  const phases: Phase[] = [];
  const push = (
    name: string,
    tables: GhostTable[],
    decorations: Decoration[] = [],
    caption = stage.caption,
  ) => {
    phases.push({
      id: `${stageIndex}:ddl:${name}:${phases.length}`,
      stageIndex,
      caption,
      durationMs: 500,
      frame: { tables, decorations },
    });
  };
  const beforeTable = (id: string) => diff.before.tables.find((table) => table.id === id);
  const afterTable = (id: string) => diff.after.tables.find((table) => table.id === id);

  for (const name of diff.addedSchemas) {
    push(
      'schema',
      [],
      [
        {
          kind: 'schema',
          id: `schema:${name}`,
          name,
          x: ctx.workArea.x,
          y: ctx.workArea.y,
          width: rem(20),
          height: rem(10),
        },
      ],
      `Создана схема ${name}`,
    );
  }
  for (const id of diff.addedTables) {
    const table = afterTable(id);
    if (!table) continue;
    const draft = { ...ghost(table, ctx), dashed: true, rows: [], hiddenRows: 0 };
    if (!draft.columns.length) push('create', [draft]);
    for (let i = 1; i <= draft.columns.length; i++) {
      push(
        'create',
        [
          {
            ...draft,
            columns: draft.columns.slice(0, i).map((column, index) => ({
              ...column,
              state: index === i - 1 ? 'added' : 'normal',
            })),
          },
        ],
        [],
        `Создаём таблицу ${table.name}`,
      );
    }
  }

  for (const change of diff.addedColumns) {
    const old = beforeTable(change.tableId);
    const next = afterTable(change.tableId);
    if (!old || !next) continue;
    push('add-before', [ghost(old, ctx)]);
    const table = ghost(next, ctx, [change.column]);
    push(
      'add-column',
      [
        {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            state: column.name === change.column ? 'added' : 'normal',
          })),
        },
      ],
      [],
      `Добавлена колонка ${change.column}`,
    );
  }
  for (const change of diff.droppedColumns) {
    const old = beforeTable(change.tableId);
    const next = afterTable(change.tableId);
    if (!old || !next) continue;
    const table = ghost(old, ctx, [change.column]);
    push('drop-before', [table]);
    push(
      'drop-column',
      [
        {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            state: column.name === change.column ? 'removed' : 'normal',
            fading: column.name === change.column,
          })),
        },
      ],
      [],
      `Удаляется колонка ${change.column}`,
    );
    push('drop-after', [ghost(next, ctx)]);
  }
  for (const change of diff.renamedColumns) {
    const old = beforeTable(change.tableId);
    const next = afterTable(change.tableId);
    if (!old || !next) continue;
    const table = ghost(old, ctx, [change.from]);
    push('rename-before', [table]);
    push('rename-out', [
      {
        ...table,
        columns: table.columns.map((column) => ({
          ...column,
          state: column.name === change.from ? 'removed' : 'normal',
          fading: column.name === change.from,
        })),
      },
    ]);
    const renamed = ghost(next, ctx, [change.to]);
    push(
      'rename-in',
      [
        {
          ...renamed,
          columns: renamed.columns.map((column) => ({
            ...column,
            state: column.name === change.to ? 'added' : 'normal',
            fadeIn: column.name === change.to,
          })),
        },
      ],
      [],
      `${change.from} → ${change.to}`,
    );
  }

  for (const change of diff.alteredColumns) {
    const old = beforeTable(change.tableId);
    const next = afterTable(change.tableId);
    if (!old || !next) continue;
    push('alter-before', [ghost(old, ctx)]);
    const table = ghost(next, ctx, [change.column]);
    push(
      'alter-type',
      [
        {
          ...table,
          columns: table.columns.map((column) => ({
            ...column,
            state: column.name === change.column ? 'highlight' : 'normal',
          })),
        },
      ],
      [],
      `${change.column}: ${change.before} → ${change.after}`,
    );
  }
  for (const change of diff.addedConstraints.filter((item) => !diff.addedTables.includes(item.tableId))) {
    const info = afterTable(change.tableId);
    if (!info) continue;
    const table = ghost(info, ctx, change.columns);
    const column = table.columns.findIndex((item) => change.columns.includes(item.name));
    const marked: GhostTable = {
      ...table,
      columns: table.columns.map((item) => ({
        ...item,
        state: change.columns.includes(item.name) ? 'highlight' : 'normal',
      })),
    };
    push('constraint-before', [table]);
    push(
      'constraint',
      [marked],
      [
        {
          kind: 'ddl-label',
          id: `constraint:${change.name}`,
          variant: 'constraint',
          x: table.x + cellLeft(table, Math.max(0, column)),
          y: table.y - rem(2),
          text: change.name,
        },
      ],
      `Добавлено ограничение ${change.name}`,
    );
  }
  for (const change of diff.addedIndexes.filter((item) => !diff.addedTables.includes(item.tableId))) {
    const info = afterTable(change.tableId);
    if (!info) continue;
    const table = ghost(info, ctx);
    push('index-before', [table]);
    push(
      'index',
      [table],
      [
        {
          kind: 'ddl-label',
          id: `index:${change.name}`,
          variant: 'index',
          x: table.x + ghostWidth(table) + rem(1),
          y: table.y,
          text: change.name,
        },
      ],
      `Создан индекс ${change.name}`,
    );
  }
  for (const info of diff.after.tables) {
    const old = beforeTable(info.id);
    if (!old || old.comment === info.comment) continue;
    const table = ghost(info, ctx);
    push(
      'comment',
      [table],
      info.comment
        ? [
            {
              kind: 'ddl-label',
              id: `comment:${info.id}`,
              variant: 'comment',
              x: table.x + ghostWidth(table) + rem(1),
              y: table.y,
              text: info.comment,
            },
          ]
        : [],
      info.comment ? 'Добавлен комментарий к таблице' : 'Комментарий к таблице удалён',
    );
  }

  if (diff.droppedTables.length) {
    const removedFks = diff.before.fks.filter(
      (fk) => !diff.after.fks.some((next) => next.name === fk.name && next.from.tableId === fk.from.tableId),
    );
    const ids = new Set([
      ...diff.droppedTables,
      ...removedFks.flatMap((fk) => [fk.from.tableId, fk.to.tableId]),
    ]);
    let tables = [...ids].flatMap((id) => {
      const info = beforeTable(id);
      return info && (ctx.nodeRect(id) || diff.droppedTables.includes(id)) ? [ghost(info, ctx)] : [];
    });
    let arrows: Decoration[] = removedFks.flatMap((fk) => {
      const from = ctx.nodeRect(fk.from.tableId);
      const to = ctx.nodeRect(fk.to.tableId);
      if (!from || !to) return [];
      return [
        {
          kind: 'arrow' as const,
          id: `fk:${fk.from.tableId}:${fk.name}`,
          tone: 'info' as const,
          from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
          to: { x: to.x + to.width / 2, y: to.y + to.height / 2 },
        },
      ];
    });
    push('drop-start', tables, arrows);
    for (const id of diff.droppedTables) {
      tables = tables.map((table) => (table.id === `t:${id}` ? { ...table, opacity: 0 } : table));
      push('drop-table', tables, arrows, `Удаляется ${id}`);
    }
    if (arrows.length) {
      arrows = arrows.map((arrow) => (arrow.kind === 'arrow' ? { ...arrow, opacity: 0 } : arrow));
      push('drop-fk', tables, arrows, 'Удаляются зависимые связи');
    }
  }
  return phases.length ? phases : genericAnimator(prev, stage, stageIndex, ctx);
};
