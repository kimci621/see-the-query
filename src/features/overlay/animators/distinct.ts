import type { RowKey } from '@/features/tracer/types';
import { clearMarks, currentTable, rebuildTable, stageRows, withTable } from '../frame';
import type { Animator, GhostRow, StageOf } from '../types';
import { genericAnimator } from './generic';

// DISTINCT: одинаковые строки съезжаются в стопку и схлопываются в одну со счётчиком ×N
export const distinctAnimator: Animator<StageOf<'distinct'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clean = clearMarks(cur);

  const stackOf = new Map<RowKey, { winner: RowKey; members: RowKey[]; group: number }>();
  let group = 0;
  for (const s of stage.stacks) {
    if (s.members.length < 2) continue;
    const entry = { ...s, group: group++ };
    for (const m of s.members) stackOf.set(m, entry);
  }

  // новый порядок: победитель на своём месте, члены стопки сразу под ним
  const byKey = new Map(clean.rows.map((r) => [r.key, r]));
  const ordered: GhostRow[] = [];
  for (const r of clean.rows) {
    const s = stackOf.get(r.key);
    if (!s) {
      ordered.push(r);
      continue;
    }
    if (s.winner !== r.key) continue;
    for (const m of [s.winner, ...s.members.filter((k) => k !== s.winner)]) {
      const row = byKey.get(m);
      if (!row) continue;
      ordered.push(
        m === s.winner
          ? { ...row, state: 'kept', group: s.group, badge: `×${s.members.length}` }
          : { ...row, state: 'dropped', group: s.group },
      );
    }
  }
  const stacked = { ...clean, rows: ordered };

  const result = rebuildTable(cur, stage.output, undefined, stageRows(stage));
  const collapsed = {
    ...result,
    rows: result.rows.map((r) => {
      const s = stackOf.get(r.key);
      return s && s.winner === r.key ? { ...r, badge: `×${s.members.length}` } : r;
    }),
  };

  const head = stage.on ? `DISTINCT ON (${stage.on.join(', ')})` : 'DISTINCT';
  const collapsePhase = {
    id: `${stageIndex}:collapse`,
    stageIndex,
    caption: stage.caption,
    durationMs: 600,
    frame: { tables: withTable(prev, collapsed).tables, decorations: [] },
  };
  // Сжатый режим Ф5: стопок нет, только итог
  if (stage.compressed) return [collapsePhase];
  return [
    {
      id: `${stageIndex}:stack`,
      stageIndex,
      caption: `${head}: одинаковые строки собираются в стопки`,
      durationMs: 800,
      frame: { tables: withTable(prev, stacked).tables, decorations: [] },
    },
    collapsePhase,
  ];
};
