import { formatCell } from '@/features/board/format';
import type { RowKey } from '@/features/tracer/types';
import { clearMarks, currentTable, mapColumns, mapRows, rebuildTable, stageRows, withTable } from '../frame';
import type { Animator, Decoration, GhostRow, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

function boundsOf(frame: string, index: number, size: number): [number, number] | null {
  if (!frame.startsWith('ROWS ')) return null;
  const text = frame.replace(/^ROWS\s+/, '').replace(/^BETWEEN\s+/, '');
  if (!/^ROWS|BETWEEN|CURRENT|PRECEDING|FOLLOWING/.test(frame)) return null;
  const parts = text.split(/\s+AND\s+/);
  const bound = (part: string): number | null => {
    if (/UNBOUNDED PRECEDING/.test(part)) return 0;
    if (/UNBOUNDED FOLLOWING/.test(part)) return size - 1;
    if (/CURRENT ROW/.test(part)) return index;
    const n = Number(part.match(/(\d+)\s+(PRECEDING|FOLLOWING)/)?.[1] ?? NaN);
    if (Number.isNaN(n)) return null;
    return part.includes('PRECEDING') ? index - n : index + n;
  };
  const start = bound(parts[0] ?? '');
  const end = parts.length > 1 ? bound(parts[1]) : index;
  if (start === null || end === null) return null;
  return [Math.max(0, Math.min(size - 1, start)), Math.max(0, Math.min(size - 1, end))];
}

function rangeBounds(
  frame: string,
  index: number,
  peers: RowKey[][],
  members: RowKey[],
): [number, number] | null {
  const peer = peers.find((group) => group.includes(members[index]));
  if (!peer) return null;
  const first = members.indexOf(peer[0]);
  const last = members.indexOf(peer[peer.length - 1]);
  const match = frame.match(
    /^RANGE BETWEEN (UNBOUNDED PRECEDING|CURRENT ROW) AND (CURRENT ROW|UNBOUNDED FOLLOWING)$/,
  );
  if (!match) return null;
  return [match[1] === 'CURRENT ROW' ? first : 0, match[2] === 'CURRENT ROW' ? last : members.length - 1];
}

// PARTITION BY: строки окрашиваются по партициям, но не схлопываются; рамка едет по строкам
export const windowAnimator: Animator<StageOf<'window'>> = (prev, stage, stageIndex, ctx) => {
  const cur = currentTable(prev);
  if (!cur) return genericAnimator(prev, stage, stageIndex, ctx);
  const clean = clearMarks(cur);

  const groupOf = new Map<RowKey, number>();
  stage.partitions.forEach((part, i) => {
    for (const key of part.members) groupOf.set(key, i);
  });
  const colored = mapRows(clean, (r) => ({ group: groupOf.get(r.key) }));

  const brackets: Decoration[] = [];
  const rows: GhostRow[] = [];
  const byKey = new Map(colored.rows.map((r) => [r.key, r]));
  stage.partitions.forEach((part, i) => {
    const from = rows.length;
    for (const key of part.members) {
      const row = byKey.get(key);
      if (row) rows.push(row);
    }
    if (rows.length > from)
      brackets.push({ kind: 'bracket', table: cur.id, fromRow: from, toRow: rows.length - 1, color: i });
  });
  rows.push(...colored.rows.filter((r) => !groupOf.has(r.key)));
  const partitioned = { ...colored, rows };

  const head = `ОКНО ${stage.functions.join(', ')}`;
  const phases: Phase[] = [
    {
      id: `${stageIndex}:partitions`,
      stageIndex,
      caption: `${head}: строки окрашиваются по партициям, строки не схлопываются`,
      durationMs: 650,
      frame: { tables: withTable(prev, partitioned).tables, decorations: [] },
    },
  ];

  // Рамка: скобка вокруг строк, которые участвуют в вычислении текущей строки.
  // ponytail: RANGE со смещением не рисуем; для поддержки нужны границы из PostgreSQL.
  const first = stage.partitions[0]?.members ?? [];
  const framePhases: Phase[] = [];
  if (stage.frame && first.length > 1) {
    const indexes = first.flatMap((key, i) => (byKey.has(key) ? [i] : []));
    const step = Math.max(1, Math.ceil(indexes.length / 8));
    for (let at = 0; at < indexes.length; at += step) {
      const start = indexes[at];
      const peers = stage.partitions[0]?.peers;
      const range =
        stage.frame.startsWith('RANGE ') && peers
          ? rangeBounds(stage.frame, start, peers, first)
          : boundsOf(stage.frame, start, first.length);
      if (!range) break;
      const from = rows.findIndex((r) => r.key === first[range[0]]);
      const to = rows.findIndex((r) => r.key === first[range[1]]);
      const atRow = rows.findIndex((r) => r.key === first[start]);
      if (from < 0 || to < 0 || atRow < 0) continue;
      framePhases.push({
        id: `${stageIndex}:frame:${at}`,
        stageIndex,
        caption: `${head}: ${stage.frame}`,
        durationMs: 400,
        frame: {
          tables: withTable(prev, partitioned).tables,
          decorations: [
            { kind: 'bracket', table: cur.id, fromRow: from, toRow: to, color: 7, label: 'рамка' },
            { kind: 'scanner', table: cur.id, rowIndex: atRow },
          ],
        },
      });
    }
  }

  const result = mapColumns(rebuildTable(cur, stage.output, undefined, stageRows(stage)), (c) => ({
    state: stage.computed.includes(c.name) ? 'computed' : 'normal',
  }));
  const computedRows = mapRows(result, (r) => ({ group: groupOf.get(r.key) }));
  const computedPhase: Phase = {
    id: `${stageIndex}:computed`,
    stageIndex,
    caption: stage.caption,
    durationMs: 700,
    frame: { tables: withTable(prev, computedRows).tables, decorations: brackets },
  };

  // Ничьи по ключам окна: rank и dense_rank считают их по-разному
  const tiePhase: Phase[] = [];
  const orderCol = cur.columns.findIndex((c) => stage.orderKeys.includes(c.name));
  if (orderCol >= 0 && stage.functions.some((f) => f === 'rank' || f === 'dense_rank')) {
    const seen = new Map<string, number>();
    for (const r of colored.rows) {
      const text = formatCell(r.values[orderCol], cur.columns[orderCol]?.type).text;
      seen.set(text, (seen.get(text) ?? 0) + 1);
    }
    const ties = mapRows(colored, (r) => {
      const text = formatCell(r.values[orderCol], cur.columns[orderCol]?.type).text;
      return (seen.get(text) ?? 0) > 1 ? { badge: 'ничья' } : {};
    });
    if ([...seen.values()].some((n) => n > 1))
      tiePhase.push({
        id: `${stageIndex}:ties`,
        stageIndex,
        caption: `${head}: равные ключи ${stage.orderKeys.join(', ')} дают ничью`,
        durationMs: 550,
        frame: { tables: withTable(prev, ties).tables, decorations: brackets },
      });
  }

  return [...phases, ...framePhases, ...tiePhase, computedPhase];
};
