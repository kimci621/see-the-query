import { rem } from '@/features/board/layout';
import { rowKeyOf } from '@/features/tracer/rowkey';
import { plural, rowsWord } from '@/lib/plural';
import { clearMarks, counterNear, mapColumns, mapRows, rebuildTable, stageRows } from '../frame';
import { cellLeft, ghostWidth, rowTop, TABLE_GAP } from '../geometry';
import type { Animator, Decoration, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

export const expandAnimator: Animator<StageOf<'expand'>> = (prev, stage, stageIndex, ctx) => {
  const source = prev.tables.find((table) => table.id === `t:${stage.sourceAlias}`);
  if (!source) return genericAnimator(prev, stage, stageIndex, ctx);
  const others = prev.tables.filter((table) => table.id !== source.id);
  const children = new Map(stage.children.map((group) => [group.parent, group.keys.length]));
  const marked = mapRows(
    mapColumns(clearMarks(source), (column) => ({
      state: column.name === stage.sourceColumn ? 'highlight' : 'normal',
    })),
    (row) => {
      const n = children.get(row.key) ?? 0;
      return { badge: `${n} ${plural(n, 'элемент', 'элемента', 'элементов')}` };
    },
  );
  const columns = stage.output.columns.flatMap((column, i) =>
    column.source?.alias === stage.alias ? [i] : [],
  );
  const relation = {
    columns: columns.map((i) => stage.output.columns[i]),
    rows: stage.output.rows.map((row) => ({ ...row, values: columns.map((i) => row.values[i]) })),
  };
  const result = rebuildTable(
    { id: `t:${stage.alias}`, title: stage.alias, x: source.x + ghostWidth(source) + TABLE_GAP, y: source.y },
    relation,
  );
  const sourceColumn = Math.max(
    0,
    source.columns.findIndex((column) => column.name === stage.sourceColumn),
  );
  const sourceRows = new Map(source.rows.map((row, i) => [row.key, i]));
  const outputRows = new Map(stage.output.rows.map((row) => [row.key, row]));
  const resultRows = result.rows.map((row) => {
    const lineage = outputRows.get(row.key)?.lineage ?? {};
    const parent = rowKeyOf(lineage, [stage.sourceAlias]);
    const index = sourceRows.get(parent) ?? 0;
    return {
      ...row,
      origin: {
        x: source.x + cellLeft(source, sourceColumn) - result.x,
        y: source.y + rowTop(index) - result.y,
      },
    };
  });
  // ponytail: в высоком результате камера показывает первые 12 строк; остальные доступны панорамированием
  const left = source.x + cellLeft(source, Math.max(0, sourceColumn - 1));
  const camera =
    resultRows.length > 12
      ? { x: left, y: source.y, width: result.x + ghostWidth(result) + rem(7) - left, height: rowTop(13) }
      : undefined;
  const count = stage.output.rows.length;
  const counter = counterNear(
    result,
    `${stageIndex}:counter`,
    `${count} ${plural(count, 'элемент', 'элемента', 'элементов')}`,
  );
  const phases: Phase[] = [
    {
      id: `${stageIndex}:source`,
      stageIndex,
      caption: `${stage.fn}: раскрываем ${stage.sourceColumn}`,
      durationMs: 500,
      frame: { tables: [...others, marked], decorations: [] },
    },
  ];
  const empty = {
    ...result,
    rows: [],
    hiddenRows: 0,
    columns: result.columns.map((column) => ({ ...column, state: 'added' as const })),
  };
  phases.push({
    id: `${stageIndex}:columns`,
    stageIndex,
    caption: `${stage.fn}: появляются колонки ${stage.alias}`,
    durationMs: 400,
    frame: { tables: [...others, marked, empty], decorations: [counter] },
  });
  // ponytail: не больше 20 фаз появления; для больших наборов переходить к виртуализации по видимым строкам
  const step = Math.max(1, Math.ceil(resultRows.length / 20));
  for (let n = step; n < resultRows.length + step; n += step) {
    const shown = resultRows.slice(0, n);
    phases.push({
      id: `${stageIndex}:rows:${n}`,
      stageIndex,
      caption: `${stage.fn}: элементы становятся строками`,
      durationMs: 250,
      frame: { tables: [...others, marked, { ...result, rows: shown }], decorations: [counter], camera },
    });
  }
  const brackets: Decoration[] = stage.children.flatMap((group, color) => {
    const positions = resultRows.flatMap((row, i) => {
      const lineage = outputRows.get(row.key)?.lineage ?? {};
      return rowKeyOf(lineage, [stage.sourceAlias]) === group.parent ? [i] : [];
    });
    return positions.length
      ? [
          {
            kind: 'bracket' as const,
            table: result.id,
            fromRow: positions[0],
            toRow: positions[positions.length - 1],
            color,
          },
        ]
      : [];
  });
  phases.push({
    id: `${stageIndex}:links`,
    stageIndex,
    caption: stage.caption,
    durationMs: 600,
    frame: {
      tables: [...others, marked, { ...result, rows: resultRows }],
      decorations: [counter, ...brackets],
      camera,
    },
  });
  const merged = rebuildTable(
    {
      id: `t:${stage.sourceAlias}|${stage.alias}`,
      title: `${source.title} + ${stage.alias}`,
      x: source.x,
      y: source.y,
      fold: source.fold,
    },
    stage.output,
    undefined,
    stageRows(stage),
  );
  phases.push({
    id: `${stageIndex}:result`,
    stageIndex,
    caption: stage.caption,
    durationMs: 500,
    frame: {
      tables: [...others, merged],
      decorations: [counterNear(merged, `${stageIndex}:total`, rowsWord(stageRows(stage)))],
    },
  });
  return phases;
};
