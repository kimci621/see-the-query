import { describe, expect, it } from 'vitest';
import { withDataset } from '../../../tests/helpers/db';
import { decodeKey, readBTreeIndex, searchPath } from './btree';

describe('B-дерево PostgreSQL', () => {
  it('декодирует знаковый bigint и не теряет большие значения', () => {
    expect(decodeKey('88 13 00 00 00 00 00 00')).toBe(5000);
    expect(decodeKey('ff ff ff ff ff ff ff ff')).toBe(-1);
    expect(decodeKey('00 00 00 00 00 00 20 00')).toBeNull();
    expect(decodeKey('')).toBeNull();
  });

  it('спускается по последнему разделителю строго меньше ключа', () => {
    const index = {
      tableId: 'public.orders',
      column: 'order_id',
      rootPage: 3,
      level: 1,
      pages: 4,
      rootItems: [
        { offset: 1, key: null, ctid: '(2,1)' },
        { offset: 2, key: 10, ctid: '(4,1)' },
        { offset: 3, key: 20, ctid: '(5,1)' },
      ],
    };
    expect(searchPath(index, 10)?.leafPage).toBe(2);
    expect(searchPath(index, 11)?.leafPage).toBe(4);
    expect(searchPath(index, 20)?.leafPage).toBe(4);
    expect(searchPath(index, 21)?.leafPage).toBe(5);
    expect(searchPath({ ...index, level: 2 }, 21)).toBeNull();
  });

  it('читает реальный индекс большого набора и находит путь к ключу', async () => {
    await withDataset('big_bookstore', async (db) => {
      const index = await readBTreeIndex(db, 'public.orders_pkey');
      expect(index).not.toBeNull();
      if (!index) throw new Error('Индекс не прочитан');
      expect(index.level).toBe(1);
      expect(index.rootItems[0].key).toBeNull();
      expect(index.rootItems.length).toBeGreaterThan(100);
      const path = searchPath(index, 5000);
      expect(path?.leafPage).toBeGreaterThan(0);
      const items = await db.query('select data from bt_page_items($1, $2::bigint)', [
        'public.orders_pkey',
        path?.leafPage,
      ]);
      expect(items.rows.some(([data]) => decodeKey(String(data)) === 5000)).toBe(true);
    });
  }, 120_000);
});
