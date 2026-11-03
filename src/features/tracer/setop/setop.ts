import { rowsWord } from '@/lib/plural';
import { resultKey } from '../rowkey';
import type { Relation, Row, Stage, Trace } from '../types';
import { rowCanon } from '../verify';

export type SetopOp = 'union' | 'union all' | 'intersect' | 'intersect all' | 'except' | 'except all';

interface Counted {
  values: unknown[];
  lineage: Row['lineage'];
  count: number;
}

// Канон строки с кратностью: UNION ALL и INTERSECT ALL различают дубли
function countRows(relation: Relation): Map<string, Counted> {
  const rows = new Map<string, Counted>();
  for (const row of relation.rows) {
    const key = rowCanon(row.values);
    const found = rows.get(key);
    if (found) found.count++;
    else rows.set(key, { values: row.values, lineage: row.lineage, count: 1 });
  }
  return rows;
}

function outputRows(op: SetopOp, left: Relation, right: Relation): Row[] {
  const l = countRows(left);
  const r = countRows(right);
  const values: Array<{ values: unknown[]; lineage: Row['lineage'] }> = [];
  const push = (item: Counted, times = 1) => {
    for (let i = 0; i < times; i++) values.push({ values: item.values, lineage: item.lineage });
  };
  if (op === 'union all') {
    for (const item of left.rows) values.push({ values: item.values, lineage: item.lineage });
    for (const item of right.rows) values.push({ values: item.values, lineage: item.lineage });
  } else if (op === 'union') {
    for (const item of l.values()) push(item);
    for (const [key, item] of r) if (!l.has(key)) push(item);
  } else if (op === 'intersect') {
    for (const [key, item] of l) if (r.has(key)) push(item);
  } else if (op === 'intersect all') {
    for (const [key, item] of l) push(item, Math.min(item.count, r.get(key)?.count ?? 0));
  } else if (op === 'except') {
    for (const [key, item] of l) if (!r.has(key)) push(item);
  } else {
    for (const [key, item] of l) push(item, Math.max(0, item.count - (r.get(key)?.count ?? 0)));
  }
  return values.map((item, index) => ({ key: resultKey(index), ...item }));
}

export function setopLabel(op: SetopOp): string {
  return op.toUpperCase();
}

// Итог множества по канону с кратностями; колонки берём из левой ветви, как PostgreSQL
export function setopStage(left: Trace, right: Trace, op: SetopOp): Stage & { kind: 'setop' } {
  const leftRelation = left.stages.at(-1)?.output;
  const rightRelation = right.stages.at(-1)?.output;
  if (!leftRelation || !rightRelation) throw new Error('setop: у ветви нет выходной стадии');
  const output: Relation = {
    columns: leftRelation.columns,
    rows: outputRows(op, leftRelation, rightRelation),
  };
  return {
    id: '0:setop',
    kind: 'setop',
    op,
    branches: [left, right],
    caption: `${setopLabel(op)}: ${rowsWord(output.rows.length)}`,
    output,
  };
}
