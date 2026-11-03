import type { FuncCall, SelectStmt, WindowDef } from '@pgsql/types';
import { captions } from '../captions';
import { sqlOf, TraceFallback } from '../probe';
import { rangeOf, stageId } from '../select/context';
import type { SelectStep } from '../select/pipeline';
import type { Column, Relation, Row, RowKey } from '../types';
import { rowCanon } from '../verify';
import { funcName } from '../whitelist';

const FRAME_NONDEFAULT = 0x00001;
const FRAME_ROWS = 0x00004;
const FRAME_GROUPS = 0x00008;
const FRAME_BETWEEN = 0x00010;

function windowCalls(sel: SelectStmt): FuncCall[] {
  const calls = new Map<string, FuncCall>();
  for (const node of sel.targetList ?? []) {
    const rt = 'ResTarget' in node ? node.ResTarget : null;
    if (!rt?.val || !('FuncCall' in rt.val)) continue;
    const fc = rt.val.FuncCall;
    if (!fc.over) continue;
    const text = sqlOf({ FuncCall: fc });
    if (!calls.has(text)) calls.set(text, fc);
  }
  return [...calls.values()];
}

function frameText(def: WindowDef): string | undefined {
  const flags = def.frameOptions ?? 0;
  if (!(flags & FRAME_NONDEFAULT)) return undefined;
  const mode = flags & FRAME_ROWS ? 'ROWS' : flags & FRAME_GROUPS ? 'GROUPS' : 'RANGE';
  const bound = (start: boolean): string => {
    if (start) {
      if (flags & 0x00020) return 'UNBOUNDED PRECEDING';
      if (flags & 0x00080) return 'CURRENT ROW';
      if (flags & 0x00040) return `${def.startOffset ? sqlOf(def.startOffset) : '?'} PRECEDING`;
      if (flags & 0x00100) return `${def.startOffset ? sqlOf(def.startOffset) : '?'} FOLLOWING`;
    } else {
      if (flags & 0x00800) return 'UNBOUNDED FOLLOWING';
      if (flags & 0x02000) return 'CURRENT ROW';
      if (flags & 0x01000) return `${def.endOffset ? sqlOf(def.endOffset) : '?'} PRECEDING`;
      if (flags & 0x04000) return `${def.endOffset ? sqlOf(def.endOffset) : '?'} FOLLOWING`;
    }
    return '';
  };
  return flags & FRAME_BETWEEN
    ? `${mode} BETWEEN ${bound(true)} AND ${bound(false)}`
    : `${mode} ${bound(true)}`;
}

// Оконные значения считает сам Postgres одной пробой: JS только раскладывает строки по партициям
export const windowStep: SelectStep = {
  name: 'window',
  applies: (ctx) => windowCalls(ctx.sel).length > 0,
  async run(ctx) {
    const calls = windowCalls(ctx.sel);
    const windows = calls.map((fc) => sqlOf({ FuncCall: fc }));
    const partitionSql: string[] = [];
    for (const fc of calls) {
      for (const node of fc.over?.partitionClause ?? []) {
        const text = sqlOf(node);
        if (!partitionSql.includes(text)) partitionSql.push(text);
      }
    }
    const orderKeys = (calls[0]?.over?.orderClause ?? []).flatMap((node) =>
      'SortBy' in node && node.SortBy.node ? [sqlOf(node.SortBy.node)] : [],
    );
    const select = [...partitionSql, ...windows, `${ctx.sql.rowKey} AS __vs_key`];
    // Порядок строк важен сцене: партиции идут по ключам, внутри по ORDER BY окна, ничьи по ctid
    const orderParts = [...partitionSql, ...orderKeys];
    const order = ` ORDER BY ${[...orderParts, ctx.sql.rowKey].join(', ')}`;
    const result = await ctx.prober.rows(
      `SELECT ${select.join(', ')}${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}${order}`,
    );
    const p = partitionSql.length;
    const n = windows.length;
    const keyIndex = p + n;
    const types = await ctx.typeNames(result.fields.map((f) => f.dataTypeID));
    const computed: Column[] = result.fields.slice(p, p + n).map((field) => ({
      name: field.name,
      type: types.get(field.dataTypeID) ?? 'unknown',
    }));
    const partitionMembers = new Map<string, RowKey[]>();
    const values = new Map<RowKey, unknown[]>();
    for (const row of result.rows) {
      const key = row[keyIndex] as RowKey;
      const partition = rowCanon(row.slice(0, p));
      const members = partitionMembers.get(partition) ?? [];
      members.push(key);
      partitionMembers.set(partition, members);
      values.set(key, row.slice(p, p + n));
    }
    const input = ctx.columns;
    const rows: Row[] = ctx.rows.map((row) => {
      const extra = values.get(row.key);
      if (!extra) throw new TraceFallback('Окно не нашло строку пробы');
      return { ...row, values: [...row.values, ...extra] };
    });
    const output: Relation = { columns: [...input, ...computed], rows };
    const first = calls[0]?.over;
    const groups = partitionSql.length
      ? [...partitionMembers.values()]
      : [result.rows.map((row) => row[keyIndex] as RowKey)];
    ctx.stages.push({
      id: stageId(ctx, 'window'),
      kind: 'window',
      partitions: groups.map((members) => ({ members })),
      computed: computed.map((column) => column.name),
      functions: calls.map(funcName),
      orderKeys,
      ...(first && frameText(first) ? { frame: frameText(first) } : {}),
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: captions.window(calls.map(funcName), rows.length),
      output,
    });
  },
};
