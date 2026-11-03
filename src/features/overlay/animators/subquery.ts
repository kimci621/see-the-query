import type { Relation } from '@/features/tracer/types';
import { clearMarks, counterNear, currentTable, mapRows, rebuildTable, stageRows, withTable } from '../frame';
import { ghostHeight, ghostWidth, rowAnchor, TABLE_GAP } from '../geometry';
import type { Animator, Decoration, Frame, GhostTable, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

function miniTable(id: string, title: string, relation: Relation, x: number, y: number): GhostTable {
  return { ...rebuildTable({ id, title, x, y }, relation, undefined, relation.rows.length), dashed: true };
}

function samplePhases(prev: Frame, stage: StageOf<'subquery'>, stageIndex: number, cur: GhostTable): Phase[] {
  const phases: Phase[] = [];
  const x = cur.x + ghostWidth(cur) + TABLE_GAP * 2;
  let y = cur.y;
  const tables: GhostTable[] = [];
  const arrows: Decoration[] = [];
  for (const [i, sample] of stage.samples.entries()) {
    const inner = sample.inner.stages.at(-1)?.output;
    if (!inner) continue;
    const table = miniTable(`${stageIndex}:sample${i}`, `подзапрос для строки ${i + 1}`, inner, x, y);
    tables.push(table);
    const anchor = rowAnchor(cur, sample.outer, 'right');
    if (anchor)
      arrows.push({
        kind: 'arrow',
        id: `${stageIndex}:sample-arrow${i}`,
        from: { x: anchor.x, y: anchor.y },
        to: { x: table.x, y: table.y + ghostHeight(table) / 2 },
        tone: 'info',
      });
    phases.push({
      id: `${stageIndex}:sample${i}`,
      stageIndex,
      caption: `${stage.caption}: строка ${i + 1}`,
      durationMs: 550,
      frame: {
        tables: [...prev.tables.filter((t) => t.id !== cur.id), cur, ...tables],
        decorations: [...arrows],
      },
    });
    y += ghostHeight(table) + TABLE_GAP;
  }
  return phases;
}

// Подзапрос: скалярный схлопывается в значение, коррелированный запускает мини-сцены,
// IN / EXISTS / ANY / ALL подсвечивают вердикты на строках, LATERAL приклеивает итог
export const subqueryAnimator: Animator<StageOf<'subquery'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);

  if (stage.mode === 'scalar') {
    const relation: Relation = {
      columns: [{ name: 'значение', type: 'unknown' }],
      rows: [{ key: 'r:0', lineage: {}, values: [stage.value ?? null] }],
    };
    const mini = miniTable(`${stageIndex}:value`, 'подзапрос', relation, ctx.workArea.x, ctx.workArea.y);
    const anchor = rowAnchor(cur, cur.rows[0]?.key ?? '', 'right');
    const decorations: Decoration[] = anchor
      ? [
          {
            kind: 'arrow',
            id: `${stageIndex}:value-arrow`,
            from: { x: anchor.x, y: anchor.y },
            to: { x: mini.x, y: mini.y + ghostHeight(mini) / 2 },
            tone: 'info',
          },
        ]
      : [];
    return [
      {
        id: `${stageIndex}:value`,
        stageIndex,
        caption: stage.caption,
        durationMs: 700,
        frame: { tables: [...prev.tables, mini], decorations },
      },
    ];
  }

  if (stage.samples.length) {
    const samples = samplePhases(prev, stage, stageIndex, cur);
    if (stage.mode === 'lateral') {
      const result = rebuildTable(cur, stage.output, undefined, stageRows(stage));
      return [
        ...samples,
        {
          id: `${stageIndex}:lateral-result`,
          stageIndex,
          caption: stage.caption,
          durationMs: 700,
          frame: {
            tables: [result],
            decorations: [counterNear(result, `${stageIndex}:counter`, `${stage.output.rows.length} строк`)],
          },
        },
      ];
    }
    return samples;
  }

  if (!stage.verdicts) return genericAnimator(prev, stage, stageIndex, ctx);

  const verdicts = stage.verdicts;
  const label = stage.mode.toUpperCase();
  const marked = mapRows(clearMarks(cur), (r) => {
    const verdict = verdicts[r.key];
    if (verdict === true) return { state: 'kept', badge: label };
    if (verdict === false) return { state: 'dropped', badge: label };
    if (verdict === null) return { state: 'unknown', badge: 'UNKNOWN' };
    return {};
  });
  const yes = Object.values(verdicts).filter((v) => v === true).length;
  const unknown = Object.values(verdicts).filter((v) => v === null).length;
  return [
    {
      id: `${stageIndex}:verdicts`,
      stageIndex,
      caption: unknown ? `${stage.caption}: UNKNOWN у ${unknown} строк` : `${stage.caption}`,
      durationMs: 650,
      frame: { tables: withTable(prev, marked).tables, decorations: [] },
    },
    {
      id: `${stageIndex}:counter`,
      stageIndex,
      caption: `${label}: прошло ${yes} из ${Object.keys(verdicts).length}`,
      durationMs: 450,
      frame: {
        tables: withTable(prev, marked).tables,
        decorations: [counterNear(marked, `${stageIndex}:verdict-counter`, `${yes} да`)],
      },
    },
  ];
};
