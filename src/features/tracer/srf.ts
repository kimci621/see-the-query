import type { FuncCall, Node, SelectStmt } from '@pgsql/types';
import type { ParsedStatement } from '@/features/sql/types';
import { funcName, walk } from './whitelist';

export const SRF_FUNCTIONS = ['unnest', 'jsonb_array_elements', 'jsonb_each'] as const;
export const SRF_ORDINAL = '__vs_ordinality';

export interface SrfFromItem {
  fn: string;
  alias: string;
  sourceAlias: string;
  sourceColumn: string;
  ordinalColumn: string;
  ordinalVisible: boolean;
}

export function findSrfFromItems(stmt: ParsedStatement): SrfFromItem[] {
  if (!('SelectStmt' in stmt.ast)) return [];
  const found: SrfFromItem[] = [];
  const prior = new Set<string>();
  for (const node of stmt.ast.SelectStmt.fromClause ?? []) {
    if ('RangeVar' in node) prior.add(node.RangeVar.alias?.aliasname ?? node.RangeVar.relname ?? '');
    if ('RangeSubselect' in node && node.RangeSubselect.alias?.aliasname)
      prior.add(node.RangeSubselect.alias.aliasname);
    if (!('RangeFunction' in node)) continue;
    const range = node.RangeFunction;
    const f = range.functions?.[0];
    const call = f && 'List' in f ? f.List.items?.[0] : undefined;
    const fc = call && 'FuncCall' in call ? call.FuncCall : undefined;
    const name = fc ? funcName(fc) : '';
    const arg = fc?.args?.[0];
    const fields = arg && 'ColumnRef' in arg ? arg.ColumnRef.fields : undefined;
    const names = (fields ?? []).flatMap((part) =>
      'String' in part && part.String.sval ? [part.String.sval] : [],
    );
    const alias = range.alias?.aliasname ?? name;
    if (
      !alias ||
      range.functions?.length !== 1 ||
      fc?.args?.length !== 1 ||
      !SRF_FUNCTIONS.some((fn) => fn === name) ||
      names.length !== 2 ||
      !prior.has(names[0])
    )
      continue;
    const ordinalIndex = name === 'jsonb_each' ? 2 : 1;
    const ordinalAlias = range.alias?.colnames?.[ordinalIndex];
    const ordinalColumn = range.ordinality
      ? ordinalAlias && 'String' in ordinalAlias
        ? (ordinalAlias.String.sval ?? 'ordinality')
        : 'ordinality'
      : SRF_ORDINAL;
    found.push({
      fn: name,
      alias,
      sourceAlias: names[0],
      sourceColumn: names[1],
      ordinalColumn,
      ordinalVisible: Boolean(range.ordinality),
    });
    prior.add(alias);
  }
  return found;
}

export function hasSrfTarget(sel: SelectStmt): boolean {
  let found = false;
  walk(sel.targetList, (key, value) => {
    if (key === 'FuncCall' && SRF_FUNCTIONS.some((fn) => fn === funcName(value as FuncCall))) found = true;
  });
  return found;
}

export function withSrfOrdinal(node: Node, item: SrfFromItem): Node {
  if (!('RangeFunction' in node)) return node;
  const range = node.RangeFunction;
  if (item.ordinalVisible) return node;
  const defaults = item.fn === 'jsonb_each' ? ['key', 'value'] : [item.fn === 'unnest' ? 'unnest' : 'value'];
  const named = (range.alias?.colnames ?? []).map((n) => ('String' in n ? n.String.sval : undefined));
  const colnames = defaults.map((name, i) => ({ String: { sval: named[i] ?? name } }));
  colnames.push({ String: { sval: SRF_ORDINAL } });
  return { RangeFunction: { ...range, ordinality: true, alias: { aliasname: item.alias, colnames } } };
}
