import { describe, expect, it } from 'vitest';
import { initParser } from '@/features/sql/parser';
import { rowsRead } from '@/features/tracer/explain';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { loadBTreeScene } from './btree-scene';

describe('сцена B-дерева', () => {
  it('читает путь и сравнивает реальные планы для одного ключа', async () => {
    await initParser();
    await withDataset('big_bookstore', async (db) => {
      const before = await db.query(
        "select current_setting('enable_indexscan'), exists (select 1 from pg_extension where extname = 'pageinspect')",
      );
      await inPreview(db, async () => {
        const scene = await loadBTreeScene(db, 'orders', 'orders_pkey', 'order_id', 5000);
        expect(scene.index.level).toBe(1);
        expect(scene.tableRows).toBe(100000);
        expect(scene.heapPages).toBeGreaterThan(0);
        expect(scene.heapCtid).toMatch(/^\(\d+,\d+\)$/);
        expect(scene.targetLeaf).toBeGreaterThan(0);
        expect(scene.seqPlan.nodeType).toBe('Seq Scan');
        expect(rowsRead(scene.seqPlan)).toBe(100000);
        expect(scene.indexPlan.nodeType).toMatch(/Index/);
        const boundary = scene.index.rootItems[1].key;
        if (boundary === null) throw new Error('Нет разделителя');
        const edge = await loadBTreeScene(db, 'orders', 'orders_pkey', 'order_id', boundary);
        expect(edge.targetLeaf).not.toBeNull();
        expect(edge.targetLeaf).not.toBe(edge.initialLeaf);
        expect(edge.heapCtid).toMatch(/^\(\d+,\d+\)$/);
        expect((await db.query("select current_setting('enable_indexscan')")).rows[0][0]).toBe(
          before.rows[0][0],
        );
      });
      const after = await db.query(
        "select current_setting('enable_indexscan'), exists (select 1 from pg_extension where extname = 'pageinspect')",
      );
      expect(after.rows).toEqual(before.rows);
    });
  }, 120_000);

  it('не принимает индекс от другой таблицы и непроверенные имена', async () => {
    await initParser();
    await withDataset('bookstore', async (db) => {
      await inPreview(db, async () => {
        await expect(loadBTreeScene(db, 'customer', 'book_pkey', 'book_id', 1)).rejects.toThrow();
        await expect(
          loadBTreeScene(db, 'book; drop table customer', 'book_pkey', 'book_id', 1),
        ).rejects.toThrow();
        expect((await db.query('select count(*) from customer')).rows[0][0]).toBe(6);
      });
    });
  });
});
