import type { Relation } from '@/features/tracer/types';
import { plural, rowsWord } from '@/lib/plural';
import { counterNear, rebuildTable, stageRows } from '../frame';
import { ghostHeight, ghostWidth, TABLE_GAP } from '../geometry';
import type { Animator, Decoration, GhostTable, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

// Больше пяти слоёв подряд глаз не держит: первые три подробно, остальные свёрнуты в счётчик
const DETAIL_LAYERS = 3;

function layerTable(id: string, title: string, relation: Relation, x: number, y: number): GhostTable {
  return rebuildTable({ id, title, x, y }, relation, undefined, relation.rows.length);
}

// Рекурсивный CTE: якорь сверху, каждый шаг ниже, строки нового слоя приходят из прошлого
export const recursionAnimator: Animator<StageOf<'recursion'>> = (prev, stage, stageIndex, ctx) => {
  const iterations = stage.iterations;
  if (!iterations.length) return genericAnimator(prev, stage, stageIndex, ctx);

  const tables: GhostTable[] = [];
  const arrows: Decoration[] = [];
  let y = ctx.workArea.y;
  const shown = iterations.length > DETAIL_LAYERS + 2 ? DETAIL_LAYERS : iterations.length;
  for (let i = 0; i < shown; i++) {
    const title = i === 0 ? `якорь: ${stage.name}` : `шаг ${i}: ${stage.name}`;
    const table = layerTable(`${stageIndex}:layer${i}`, title, iterations[i], ctx.workArea.x, y);
    tables.push(table);
    if (i > 0) {
      const prevTable = tables[i - 1];
      arrows.push({
        kind: 'arrow',
        id: `${stageIndex}:arrow${i}`,
        from: { x: prevTable.x + ghostWidth(prevTable) / 2, y: prevTable.y + ghostHeight(prevTable) },
        to: { x: table.x + ghostWidth(table) / 2, y: table.y },
        tone: 'info',
      });
    }
    y += ghostHeight(table) + TABLE_GAP;
  }

  const perLayer = (i: number) => `${i === 0 ? 'якорь' : `шаг ${i}`}: ${rowsWord(iterations[i].rows.length)}`;
  const phases: Phase[] = tables.map((_, i) => ({
    id: `${stageIndex}:layer${i}`,
    stageIndex,
    caption: perLayer(i),
    durationMs: 550,
    frame: {
      tables: tables.slice(0, i + 1),
      decorations: arrows.filter((a) => a.kind === 'arrow' && Number(a.id.split('arrow')[1]) <= i),
    },
  }));

  if (shown < iterations.length) {
    const last = tables[tables.length - 1];
    phases.push({
      id: `${stageIndex}:rest`,
      stageIndex,
      caption: `${stage.caption}: ещё ${iterations.length - shown} ${plural(iterations.length - shown, 'шаг', 'шага', 'шагов')}`,
      durationMs: 600,
      frame: {
        tables: [...tables, { ...last, id: `${stageIndex}:rest`, title: '…', rows: [], opacity: 0.35 }],
        decorations: [
          counterNear(last, `${stageIndex}:counter`, `${stageRows(stage)} строк`),
          {
            kind: 'counter',
            id: `${stageIndex}:layers`,
            x: ctx.workArea.x,
            y: last.y + ghostHeight(last) + TABLE_GAP,
            text: `ещё ${iterations.length - shown} ${plural(iterations.length - shown, 'слой', 'слоя', 'слоёв')}`,
          },
        ],
      },
    });
  } else {
    phases.push({
      id: `${stageIndex}:result`,
      stageIndex,
      caption: stage.caption,
      durationMs: 650,
      frame: {
        tables,
        decorations: [
          ...arrows,
          counterNear(tables[0], `${stageIndex}:counter`, `${stageRows(stage)} строк`),
        ],
      },
    });
  }
  return phases;
};
