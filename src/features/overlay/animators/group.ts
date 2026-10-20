import { formatCell } from '@/features/board/format';
import { keyList } from '@/features/tracer/captions';
import type { RowKey } from '@/features/tracer/types';
import {
  clearMarks,
  counterNear,
  currentTable,
  mapColumns,
  mapRows,
  rebuildTable,
  shownIndices,
  stageRows,
  totalRows,
  withTable,
} from '../frame';
import type { Animator, Decoration, GhostRow, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

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
    : `: ${stage.aggregates.map((a, i) => `${a} = ${formatCell(values[i]).text}`).join(', ')}`;
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
  const nullCols = shownIndices(cur, stage.nullSkipColumns);
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
  const keyCols = shownIndices(cur, stage.keyColumns);
  const aggCols = shownIndices(cur, stage.aggregateColumns);
  const stacked = mapColumns({ ...colored, rows }, (_, i) => ({
    state: keyCols.includes(i) ? 'key' : aggCols.includes(i) ? 'highlight' : 'removed',
  }));

  const head = stage.keys.length ? `GROUP BY ${keyList(stage.keys)}` : 'Агрегат без GROUP BY';
  // Без GROUP BY группа одна: подписи про одну стопку, на пустом входе стопка пустая, а строка итога есть
  const [colorText, stackText] = stage.keys.length
    ? ['строки окрашиваются в цвет своей группы', 'группы съезжаются в стопки']
    : !totalRows(cur)
      ? ['строк нет', 'стопка пустая, итог всё равно одна строка']
      : ['одна группа на все строки', 'строки собираются в одну стопку'];

  // Без GROUP BY значение набегает: фаза на строку стопки, счётчик рядом с таблицей, NULL в count(col) серый.
  // ponytail: не больше 20 фаз, на большой стопке шаг через несколько строк
  const runAt = new Map((stage.groups[0]?.members ?? []).map((m, j) => [m, stage.running?.[j]]));
  const skipped = (r: GhostRow) => nullCols.some((c) => r.values[c] === null);
  const counted = stage.running ? stacked.rows.flatMap((r, i) => (runAt.get(r.key) ? [i] : [])) : [];
  const step = Math.ceil(counted.length / 20);
  const ticks = counted
    .filter((_, n) => (counted.length - 1 - n) % step === 0)
    .map((at, n): Phase => {
      const now = runAt.get(stacked.rows[at].key) ?? [];
      const text = stage.aggregates.map((a, k) => `${a} = ${formatCell(now[k]).text}`).join(', ');
      const t = mapRows(stacked, (r, i) => ({
        state: i > at ? 'normal' : skipped(r) ? 'unknown' : i === at ? 'matched' : 'kept',
      }));
      return {
        id: `${stageIndex}:tick:${n}`,
        stageIndex,
        caption: `${head}: ${text}`,
        durationMs: 350,
        frame: {
          tables: withTable(prev, t).tables,
          decorations: [
            ...brackets,
            { kind: 'scanner', table: cur.id, rowIndex: at },
            counterNear(t, `${stageIndex}:counter`, text),
          ],
        },
      };
    });

  return [
    {
      id: `${stageIndex}:color`,
      stageIndex,
      caption: `${head}: ${colorText}`,
      durationMs: 600,
      frame: { tables: withTable(prev, colored).tables, decorations: [] },
    },
    {
      id: `${stageIndex}:stack`,
      stageIndex,
      caption: `${head}: ${stackText}`,
      durationMs: 800,
      frame: { tables: withTable(prev, stacked).tables, decorations: brackets },
    },
    ...ticks,
    collapse,
  ];
};
