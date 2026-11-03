import type { Relation } from '@/features/tracer/types';
import { rowCanon } from '@/features/tracer/verify';
import { counterNear, currentTable, mapRows, rebuildTable, stageRows } from '../frame';
import { ghostHeight, ghostWidth, TABLE_GAP } from '../geometry';
import type { Animator, Decoration, GhostTable, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

function branchRelation(trace: StageOf<'setop'>['branches'][number]): Relation {
  return trace.stages.at(-1)?.output ?? { columns: [], rows: [] };
}

function branchTable(id: string, title: string, rel: Relation, x: number, y: number): GhostTable {
  return rebuildTable({ id, title, x, y }, rel, undefined, rel.rows.length);
}

const MAX_PAIR_LINES = 40;

// UNION / INTERSECT / EXCEPT: две ветви встают друг под другом, затем итог справа.
// UNION схлопывает дубли, INTERSECT соединяет близнецов линиями, EXCEPT вычёркивает найденное
export const setopAnimator: Animator<StageOf<'setop'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur && prev.tables.length) return genericAnimator(prev, stage, stageIndex, ctx);
  const leftRel = branchRelation(stage.branches[0]);
  const rightRel = branchRelation(stage.branches[1]);
  if (!leftRel.columns.length || !rightRel.columns.length)
    return genericAnimator(prev, stage, stageIndex, ctx);

  const left = branchTable(`${stageIndex}:left`, 'левая ветвь', leftRel, ctx.workArea.x, ctx.workArea.y);
  const right = branchTable(
    `${stageIndex}:right`,
    'правая ветвь',
    rightRel,
    ctx.workArea.x,
    left.y + ghostHeight(left) + TABLE_GAP,
  );
  const result = branchTable(
    `${stageIndex}:result`,
    'результат',
    stage.output,
    left.x + Math.max(ghostWidth(left), ghostWidth(right)) + TABLE_GAP * 2,
    left.y,
  );

  // Сколько раз строка встретилась в обеих ветвях: нужно для ×N и для «близнецов»
  const counts = new Map<string, number>();
  for (const row of [...leftRel.rows, ...rightRel.rows]) {
    const key = rowCanon(row.values);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const withCounts = mapRows(left, (r) => {
    const n = counts.get(rowCanon(r.values)) ?? 1;
    return n > 1 ? { badge: `×${n}` } : {};
  });
  const rightCounts = mapRows(right, (r) => {
    const n = counts.get(rowCanon(r.values)) ?? 1;
    return n > 1 ? { badge: `×${n}` } : {};
  });

  const branches: Phase = {
    id: `${stageIndex}:branches`,
    stageIndex,
    caption: `${stage.op.toUpperCase()}: ветви считаются отдельно`,
    durationMs: 600,
    frame: { tables: [left, right], decorations: [] },
  };
  const finish: Phase = {
    id: `${stageIndex}:result`,
    stageIndex,
    caption: stage.caption,
    durationMs: 700,
    frame: {
      tables: [result],
      decorations: [counterNear(result, `${stageIndex}:counter`, `${stageRows(stage)} строк`)],
    },
  };

  if (stage.op === 'union all') {
    return [
      branches,
      {
        id: `${stageIndex}:stack`,
        stageIndex,
        caption: 'UNION ALL: строки левой и правой ветви идут подряд, дубли остаются',
        durationMs: 700,
        frame: { tables: [withCounts, rightCounts], decorations: [] },
      },
      finish,
    ];
  }

  if (stage.op === 'union') {
    const collapsed = mapRows(result, (r) => {
      const n = counts.get(rowCanon(r.values)) ?? 1;
      return n > 1 ? { badge: `×${n} → 1` } : {};
    });
    return [
      branches,
      {
        id: `${stageIndex}:dedupe`,
        stageIndex,
        caption: 'UNION: одинаковые строки схлопываются в одну',
        durationMs: 700,
        frame: { tables: [withCounts, rightCounts], decorations: [] },
      },
      {
        ...finish,
        frame: {
          tables: [collapsed],
          decorations: [counterNear(collapsed, `${stageIndex}:counter`, `${stageRows(stage)} строк`)],
        },
      },
    ];
  }

  const rightKeys = new Set(rightRel.rows.map((r) => rowCanon(r.values)));
  if (stage.op.startsWith('intersect')) {
    const pairs: Decoration[] = [];
    const seen = new Set<string>();
    for (const row of leftRel.rows) {
      const canon = rowCanon(row.values);
      if (!rightKeys.has(canon) || seen.has(canon)) continue;
      seen.add(canon);
      const mate = rightRel.rows.find((r) => rowCanon(r.values) === canon);
      if (!mate) continue;
      pairs.push({
        kind: 'pair-line',
        id: `${stageIndex}:pair${pairs.length}`,
        from: { table: left.id, row: row.key, col: leftRel.columns[0]?.name ?? '' },
        to: { table: right.id, row: mate.key, col: rightRel.columns[0]?.name ?? '' },
      });
      if (pairs.length >= MAX_PAIR_LINES) break;
    }
    return [
      branches,
      {
        id: `${stageIndex}:pairs`,
        stageIndex,
        caption: 'INTERSECT: строки-близнецы нашлись в обеих ветвях',
        durationMs: 700,
        frame: { tables: [left, right], decorations: pairs },
      },
      finish,
    ];
  }

  // EXCEPT: строки левой ветви, которые есть справа, гаснут
  const cut = mapRows(left, (r) => (rightKeys.has(rowCanon(r.values)) ? { state: 'dropped' } : {}));
  return [
    branches,
    {
      id: `${stageIndex}:cut`,
      stageIndex,
      caption: 'EXCEPT: из левой ветви вычитаются строки, найденные в правой',
      durationMs: 700,
      frame: { tables: [cut, rightCounts], decorations: [] },
    },
    finish,
  ];
};
