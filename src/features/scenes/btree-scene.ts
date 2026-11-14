import { type BTreeIndex, decodeKey, readBTreeIndex, searchPath } from '@/features/db/btree';
import type { DbClient } from '@/features/db/types';
import { explainPlan, type PlanNode } from '@/features/tracer/explain';
import type { Locale } from '@/lib/i18n';

export interface BTreeSceneData {
  index: BTreeIndex;
  initialLeaf: number;
  targetLeaf: number | null;
  heapCtid: string | null;
  heapPages: number;
  tableRows: number;
  seqPlan: PlanNode;
  indexPlan: PlanNode;
}

const SIMPLE_NAME = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i;
const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;

// Вызывающий выполняет все запросы внутри sandbox.preview.
export async function loadBTreeScene(
  db: DbClient,
  table: string,
  indexName: string,
  column: string,
  value: number,
  locale: Locale = 'ru',
): Promise<BTreeSceneData> {
  if (
    !SIMPLE_NAME.test(table) ||
    !SIMPLE_NAME.test(indexName) ||
    !/^[a-z_][a-z0-9_]*$/i.test(column) ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      locale === 'en'
        ? 'Provide valid table and index names and an integer key.'
        : 'Укажи корректные имена таблицы, индекса и целый ключ.',
    );
  }
  const index = await readBTreeIndex(db, indexName);
  const tableId = table.includes('.') ? table.toLowerCase() : `public.${table.toLowerCase()}`;
  if (!index || index.tableId !== tableId || index.column !== column.toLowerCase()) {
    throw new Error(
      locale === 'en'
        ? 'A unique B-tree on one required bigint column of the selected table is needed.'
        : 'Нужен уникальный B-tree по одной обязательной колонке bigint выбранной таблицы.',
    );
  }
  const path = searchPath(index, value);
  if (!path)
    throw new Error(
      locale === 'en'
        ? 'The scene supports an index with one root and one leaf level.'
        : 'Сцена поддерживает индекс с одним корнем и уровнем листьев.',
    );
  const qualifiedTable = index.tableId.split('.').map(ident).join('.');
  const qualifiedColumn = ident(index.column);
  const tableStats = await db.query(
    `select count(*)::text, (pg_relation_size($1::regclass) / current_setting('block_size')::int)::int from ${qualifiedTable}`,
    [index.tableId],
  );
  const found = await db.query(`select ctid::text from ${qualifiedTable} where ${qualifiedColumn} = $1`, [
    value,
  ]);
  const heapCtid = found.rows[0]?.[0] == null ? null : String(found.rows[0][0]);
  let targetLeaf: number | null = null;
  let page = path.leafPage;
  // ponytail: проверяем начальный и соседний лист; для длинной цепочки версий нужен полный проход вправо.
  for (let attempt = 0; heapCtid && attempt < 2 && page > 0; attempt++) {
    const items = await db.query(
      'select data, htid::text from bt_page_items($1, $2::bigint) where htid is not null',
      [indexName, page],
    );
    if (items.rows.some(([data, htid]) => decodeKey(String(data)) === value && String(htid) === heapCtid)) {
      targetLeaf = page;
      break;
    }
    const next = await db.query('select btpo_next::bigint from bt_page_stats($1, $2::bigint)', [
      indexName,
      page,
    ]);
    page = Number(next.rows[0]?.[0] ?? 0);
  }
  const sql = `select * from ${qualifiedTable} where ${qualifiedColumn} = ${value}`;
  const indexPlan = await explainPlan(db, sql);
  await db.query('savepoint __vs_btree_seq');
  let seqPlan: PlanNode | null = null;
  try {
    await db.query('set local enable_indexscan = off');
    await db.query('set local enable_indexonlyscan = off');
    await db.query('set local enable_bitmapscan = off');
    seqPlan = await explainPlan(db, sql);
  } finally {
    await db.query('rollback to savepoint __vs_btree_seq');
    await db.query('release savepoint __vs_btree_seq');
  }
  if (!seqPlan || !indexPlan)
    throw new Error(
      locale === 'en' ? 'PostgreSQL did not return the query plans.' : 'PostgreSQL не вернул планы запросов.',
    );
  return {
    index,
    initialLeaf: path.leafPage,
    targetLeaf,
    heapCtid,
    tableRows: Number(tableStats.rows[0][0]),
    heapPages: Number(tableStats.rows[0][1]),
    seqPlan,
    indexPlan,
  };
}
