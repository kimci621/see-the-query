import type { RowKey } from '@/features/tracer/types';
import { clearMarks, counterNear, mapColumns, mapRows, rebuildTable, stageRows, totalRows } from '../frame';
import { ghostWidth, TABLE_GAP } from '../geometry';
import { stageLabel } from '../labels';
import type { Animator, Decoration, Frame, GhostRow, GhostTable, Phase, StageOf } from '../types';
import { genericAnimator } from './generic';

// id таблицы-результата: 't:b|a'. Следующий JOIN цепочки находит по нему левую сторону
export const joinTableId = (aliases: string[]) => `t:${aliases.join('|')}`;

// Сближение до половины обычного зазора: видно, что таблицы «съехались»
const JOIN_GAP = TABLE_GAP / 2;

// INNER / LEFT / RIGHT / FULL JOIN: сближение, линии пар, отсев непарных, слияние в одну таблицу
export const joinAnimator: Animator<StageOf<'join'>> = (prev, stage, stageIndex, ctx) => {
  const leftId = joinTableId(stage.leftAliases);
  const rightId = joinTableId([stage.rightAlias]);
  const left = prev.tables.find((t) => t.id === leftId);
  const right = prev.tables.find((t) => t.id === rightId);
  if (!left || !right) return genericAnimator(prev, stage, stageIndex, ctx);
  if (stage.joinType === 'cross') return crossPhases(prev, stage, stageIndex, left, right);
  const label = stageLabel(stage);
  const others = prev.tables.filter((t) => t.id !== leftId && t.id !== rightId);
  const frameOf = (l: GhostTable, r: GhostTable, decorations: Decoration[] = []): Frame => ({
    tables: [...others, l, r],
    decorations,
  });

  // 1. сближение: ведущая сторона стоит, другая подъезжает вплотную на ту же высоту.
  // RIGHT зеркалит LEFT: стоит правая, к ней едет левая
  const [leftKey, rightKey] = keyColumns(stage, left, right);
  const markKeys = (t: GhostTable, col: string) =>
    mapColumns(clearMarks(t), (c) => ({ state: c.name === col ? 'key' : 'normal' }));
  const mirrored = stage.joinType === 'right';
  const l1 = mirrored
    ? { ...markKeys(left, leftKey), x: right.x - ghostWidth(left) - JOIN_GAP, y: right.y }
    : markKeys(left, leftKey);
  const r1 = mirrored
    ? markKeys(right, rightKey)
    : { ...markKeys(right, rightKey), x: left.x + ghostWidth(left) + JOIN_GAP, y: left.y };
  const result = rebuildTable(
    {
      id: joinTableId([...stage.leftAliases, stage.rightAlias]),
      title: `${left.title} + ${right.title}`,
      x: l1.x,
      y: l1.y,
      fold: [...(left.fold ?? []), ...(right.fold ?? [])],
    },
    stage.output,
    undefined,
    stageRows(stage),
  );
  // Строки без пары, которые тип JOIN сохраняет: в итоге у них NULL-половина
  const keepsLeft = stage.joinType === 'left' || stage.joinType === 'full';
  const keepsRight = stage.joinType === 'right' || stage.joinType === 'full';
  const lonelyRows = new Set(
    stage.pairs.flatMap(([l, r]) => (l === null || r === null ? [pairKey(stage, l, r)] : [])),
  );
  const merged = mapRows(withBadges(result, stage), (r) =>
    lonelyRows.has(r.key) ? { state: 'null-filled' } : {},
  );
  const merge: Phase = {
    id: `${stageIndex}:merge`,
    stageIndex,
    caption: stage.caption,
    durationMs: 700,
    frame: {
      tables: [...others, merged],
      decorations: [counterNear(result, `${stageIndex}:counter`, `${stageRows(stage)} строк`)],
    },
  };
  const approach: Phase = {
    id: `${stageIndex}:approach`,
    stageIndex,
    caption: `${label}: таблицы съезжаются, ключи ${leftKey} и ${rightKey}`,
    durationMs: 700,
    frame: frameOf(l1, r1),
  };
  // Сжатый режим Ф5: пар нет, только итог
  if (stage.compressed) return [approach, merge];

  // 2. линии между ячейками ключей для каждой совпавшей пары
  const matched = stage.pairs.filter((p): p is [RowKey, RowKey] => p[0] !== null && p[1] !== null);
  const lines: Decoration[] = matched.map(([l, r], i) => ({
    kind: 'pair-line',
    id: `${stageIndex}:pair${i}`,
    from: { table: leftId, row: l, col: leftKey },
    to: { table: rightId, row: r, col: rightKey },
  }));
  const hasPair = new Set(matched.flat());
  const mark = (t: GhostTable, lonely: GhostRow['state']) =>
    mapRows(t, (r) => ({ state: hasPair.has(r.key) ? 'matched' : lonely }));
  const kept = keepsLeft || keepsRight;

  // 3. строки без пары краснеют и уходят
  return [
    approach,
    {
      id: `${stageIndex}:lines`,
      stageIndex,
      caption: `${label}: совпавшие ключи соединены линиями`,
      durationMs: 800,
      frame: frameOf(mark(l1, 'normal'), mark(r1, 'normal'), lines),
    },
    {
      id: `${stageIndex}:unmatched`,
      stageIndex,
      caption: kept
        ? `${label}: строки без пары ${keepsLeft && keepsRight ? 'с обеих сторон' : keepsLeft ? 'слева' : 'справа'} остаются, их вторая половина будет NULL`
        : `${label}: строки без пары уходят`,
      durationMs: 600,
      frame: frameOf(
        mark(l1, keepsLeft ? 'null-filled' : 'dropped'),
        mark(r1, keepsRight ? 'null-filled' : 'dropped'),
        lines,
      ),
    },
    merge,
  ];
};

// ponytail: веер рисуем не больше чем на 100 линий, дальше он превращается в сплошную заливку
const MAX_FAN_LINES = 100;

// CROSS JOIN: каждая левая строка веером расходится ко всем правым, затем сетка N × M
function crossPhases(
  prev: Frame,
  stage: StageOf<'join'>,
  stageIndex: number,
  left: GhostTable,
  right: GhostTable,
): Phase[] {
  const near = { ...clearMarks(right), x: left.x + ghostWidth(left) + JOIN_GAP, y: left.y };
  const others = prev.tables.filter((t) => t.id !== left.id && t.id !== right.id);
  const visible = new Set([...left.rows, ...right.rows].map((r) => r.key));
  const lines: Decoration[] = stage.pairs
    .filter(
      (p): p is [RowKey, RowKey] => p[0] !== null && p[1] !== null && visible.has(p[0]) && visible.has(p[1]),
    )
    .slice(0, MAX_FAN_LINES)
    .map(([l, r], i) => ({
      kind: 'pair-line',
      id: `${stageIndex}:fan${i}`,
      from: { table: left.id, row: l, col: left.columns.at(-1)?.name ?? '' },
      to: { table: right.id, row: r, col: right.columns[0]?.name ?? '' },
    }));
  const grid = rebuildTable(
    {
      id: joinTableId([...stage.leftAliases, stage.rightAlias]),
      title: `${left.title} × ${right.title}`,
      x: left.x,
      y: left.y,
      fold: [...(left.fold ?? []), ...(right.fold ?? [])],
    },
    stage.output,
    undefined,
    stageRows(stage),
  );
  const counter = `${totalRows(left)} × ${totalRows(right)} = ${stageRows(stage)}`;
  return [
    {
      id: `${stageIndex}:fan`,
      stageIndex,
      caption: 'CROSS JOIN: каждая строка слева соединяется с каждой строкой справа',
      durationMs: 800,
      frame: { tables: [...others, clearMarks(left), near], decorations: lines },
    },
    {
      id: `${stageIndex}:grid`,
      stageIndex,
      caption: stage.caption,
      durationMs: 700,
      frame: {
        tables: [...others, grid],
        decorations: [counterNear(grid, `${stageIndex}:counter`, counter)],
      },
    },
  ];
}

// Ключ строки результата для пары, как в трассировщике: 'b=(0,10)|a=∅'
function pairKey(stage: StageOf<'join'>, l: RowKey | null, r: RowKey | null): RowKey {
  const left = l ?? stage.leftAliases.map((a) => `${a}=∅`).join('|');
  return `${left}|${r ?? `${stage.rightAlias}=∅`}`;
}

// Колонки ключей для линий: из ON ('b.author_id') или первая USING-колонка
function keyColumns(stage: StageOf<'join'>, left: GhostTable, right: GhostTable): [string, string] {
  if (stage.usingColumns.length) return [stage.usingColumns[0], stage.usingColumns[0]];
  const parts = stage.onColumns.map((c) => c.split('.'));
  const col = (aliases: string[], t: GhostTable) =>
    parts.find((p) => p.length > 1 && aliases.includes(p[p.length - 2]))?.at(-1) ?? t.columns[0]?.name ?? '';
  return [col(stage.leftAliases, left), col([stage.rightAlias], right)];
}

// Клоны: строка, которая встретилась в N парах, размножилась на N строк результата
function withBadges(t: GhostTable, stage: StageOf<'join'>): GhostTable {
  const { pairs } = stage;
  const seen = new Map<RowKey, number>();
  for (const [l, r] of pairs) {
    if (l === null || r === null) continue;
    seen.set(l, (seen.get(l) ?? 0) + 1);
    seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  const byRow = new Map<RowKey, number>();
  for (const [l, r] of pairs) {
    if (l === null || r === null) continue;
    byRow.set(pairKey(stage, l, r), Math.max(seen.get(l) ?? 1, seen.get(r) ?? 1));
  }
  return mapRows(t, (r) => {
    const n = byRow.get(r.key) ?? 1;
    return n > 1 ? { badge: `×${n}` } : {};
  });
}
