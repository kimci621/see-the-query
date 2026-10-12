import type { RowKey } from '@/features/tracer/types';
import {
  clearMarks,
  counterNear,
  currentTable,
  mapColumns,
  rebuildTable,
  stageRows,
  totalRows,
  withTable,
} from '../frame';
import type { Animator, Decoration, GhostRow, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

// Агрегаты, которые пропускают NULL: count(col), sum(col) и т. п. над одной колонкой
const NULL_SKIPPING = /^(?:count|sum|avg|min|max)\(([\w.]+)\)$/;

// GROUP BY: строки окрашиваются по группам, съезжаются в стопки и схлопываются в строки-группы.
// Агрегат без GROUP BY: та же сцена с одной группой из всех строк
export const groupAnimator: Animator<StageOf<'group'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clean = clearMarks(cur);

  const result = rebuildTable(cur, stage.output, undefined, stageRows(stage));
  const values = stage.output.rows[0]?.values ?? [];
  // Без GROUP BY итог агрегатов виден прямо в подписи: count(*) = 4
  const totals = stage.keys.length
    ? ''
    : `: ${stage.aggregates.map((a, i) => `${a} = ${values[i]}`).join(', ')}`;
  const collapse: Phase = {
    id: `${stageIndex}:collapse`,
    stageIndex,
    caption: `${stage.caption}${totals}`,
    durationMs: 700,
    frame: {
      tables: withTable(prev, result).tables,
      decorations: [counterNear(result, `${stageIndex}:counter`, `${totalRows(cur)} → ${stageRows(stage)}`)],
    },
  };
  // Сжатый режим Ф5: состава групп нет, только итог
  if (stage.compressed) return [collapse];

  const groupOf = new Map<RowKey, number>();
  stage.groups.forEach((g, i) => {
    for (const m of g.members) groupOf.set(m, i);
  });
  const colored = { ...clean, rows: clean.rows.map((r) => ({ ...r, group: groupOf.get(r.key) })) };

  // Стопки: члены групп подряд, скобка на каждую группу. NULL в колонке count(col) не засчитывается
  const nullCols = stage.aggregates.flatMap((a) => {
    const col = a.match(NULL_SKIPPING)?.[1]?.split('.').at(-1);
    const i = col ? clean.columns.findIndex((c) => c.name === col) : -1;
    return i >= 0 ? [i] : [];
  });
  const byKey = new Map(colored.rows.map((r) => [r.key, r]));
  const rows: GhostRow[] = [];
  const brackets: Decoration[] = [];
  stage.groups.forEach((g, i) => {
    const members = g.members.flatMap((m) => byKey.get(m) ?? []);
    if (!members.length) return;
    brackets.push({
      kind: 'bracket',
      table: cur.id,
      fromRow: rows.length,
      toRow: rows.length + members.length - 1,
      color: i,
    });
    for (const m of members)
      rows.push(nullCols.some((c) => m.values[c] === null) ? { ...m, badge: 'NULL не считается' } : m);
  });
  rows.push(...colored.rows.filter((r) => !groupOf.has(r.key)));

  // Колонки: ключ GROUP BY подсвечен, колонка внутри агрегата видна, остальные перечёркнуты (ошибка 42803)
  const keyCols = new Set(stage.keys.map((k) => k.split('.').at(-1)));
  const inAggregate = (name: string) =>
    stage.aggregates.some((a) => a.split(/[^\p{L}\p{N}_$]+/u).includes(name));
  const stacked = mapColumns({ ...colored, rows }, (c) => ({
    state: keyCols.has(c.name) ? 'key' : inAggregate(c.name) ? 'highlight' : 'removed',
  }));

  const head = stage.keys.length ? `GROUP BY ${stage.keys.join(', ')}` : 'Агрегат без GROUP BY';
  return [
    {
      id: `${stageIndex}:color`,
      stageIndex,
      caption: `${head}: строки окрашиваются в цвет своей группы`,
      durationMs: 600,
      frame: { tables: withTable(prev, colored).tables, decorations: [] },
    },
    {
      id: `${stageIndex}:stack`,
      stageIndex,
      caption: `${head}: группы съезжаются в стопки`,
      durationMs: 800,
      frame: { tables: withTable(prev, stacked).tables, decorations: brackets },
    },
    collapse,
  ];
};
