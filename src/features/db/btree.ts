import type { DbClient } from './types';

export interface BTreeItem {
  offset: number;
  key: number | null;
  ctid: string;
}

export interface BTreeIndex {
  tableId: string;
  column: string;
  rootPage: number;
  level: number;
  pages: number;
  rootItems: BTreeItem[];
}

// Байты pageinspect для bigint в PGlite (WebAssembly использует little-endian).
export function decodeKey(data: string): number | null {
  const bytes = data.trim().split(/\s+/);
  if (bytes.length !== 8 || bytes.some((byte) => !/^[0-9a-f]{2}$/i.test(byte))) return null;
  const hex = bytes.reverse().join('');
  const value = BigInt.asIntN(64, BigInt(`0x${hex}`));
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export async function readBTreeIndex(db: DbClient, indexId: string): Promise<BTreeIndex | null> {
  const meta = await db.query(
    `select format('%I.%I', n.nspname, c.relname),
            (pg_relation_size(c.oid) / current_setting('block_size')::int)::int,
            nt.nspname || '.' || t.relname, a.attname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_index i on i.indexrelid = c.oid
     join pg_class t on t.oid = i.indrelid
     join pg_namespace nt on nt.oid = t.relnamespace
     join pg_am am on am.oid = c.relam
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where c.oid = to_regclass($1) and am.amname = 'btree'
       and i.indisvalid and i.indisunique and i.indnkeyatts = 1 and i.indnatts = 1
       and i.indpred is null and i.indexprs is null and i.indoption[0] = 0
       and a.atttypid = 'bigint'::regtype and a.attnotnull`,
    [indexId],
  );
  if (!meta.rows[0]) return null;
  const [name, pages, tableId, column] = meta.rows[0];
  await db.query('create extension if not exists pageinspect');
  const root = await db.query('select root::int, level::int from bt_metap($1)', [name]);
  if (!root.rows[0]) return null;
  const [rootPage, level] = root.rows[0].map(Number);
  const rawItems = await db.query(
    'select itemoffset::int, ctid::text, data from bt_page_items($1, $2::bigint) order by itemoffset',
    [name, rootPage],
  );
  const rootItems: BTreeItem[] = [];
  for (const [offset, ctid, data] of rawItems.rows) {
    const raw = String(data ?? '').trim();
    const key = raw ? decodeKey(raw) : null;
    if (raw && key === null) return null;
    rootItems.push({ offset: Number(offset), key, ctid: String(ctid) });
  }
  return {
    tableId: String(tableId),
    column: String(column),
    rootPage,
    level,
    pages: Number(pages),
    rootItems,
  };
}

// ponytail: сцена поддерживает двухуровневое дерево bigint; для большего дерева читать внутренние страницы рекурсивно.
export function searchPath(
  index: BTreeIndex,
  key: number,
): { leafPage: number; pivotKey: number | null } | null {
  if (index.level !== 1 || !Number.isSafeInteger(key) || index.rootItems[0]?.key !== null) return null;
  let low = 1;
  let high = index.rootItems.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const pivot = index.rootItems[middle].key;
    if (pivot === null) return null;
    if (pivot < key) low = middle + 1;
    else high = middle;
  }
  const item = index.rootItems[low - 1];
  const match = /^\((\d+),\d+\)$/.exec(item.ctid);
  return match ? { leafPage: Number(match[1]), pivotKey: item.key } : null;
}
