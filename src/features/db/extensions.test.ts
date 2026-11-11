import { describe, expect, it } from 'vitest';
import { createNodeClient } from './node-client';

describe('контрибы песочницы', () => {
  it('pg_trgm и pageinspect устанавливаются и работают', async () => {
    const db = await createNodeClient();
    try {
      await db.exec('create extension pg_trgm; create extension pageinspect;');
      const trgm = await db.query("select round(similarity('Пушкин', 'Пушкинн')::numeric, 2)::text");
      expect(trgm.rows[0][0]).toBe('0.67');
      await db.exec('create table t (x int); insert into t values (1), (2);');
      const page = await db.query("select count(*)::int from heap_page_items(get_raw_page('t', 0))");
      expect(page.rows[0][0]).toBe(2);
    } finally {
      await db.close();
    }
  });
});
