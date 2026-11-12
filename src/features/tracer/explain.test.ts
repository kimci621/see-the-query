import { beforeAll, describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { bookScan } from '@/features/overlay/__fixtures__/traces';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { explainPlan, linkPlanToStages, rowsRead } from './explain';
import { traceStatement } from './trace';

beforeAll(() => initParser());

describe('план выполнения', () => {
  it('считает строки с учётом фильтра и числа проходов', () => {
    expect(rowsRead({ nodeType: 'Seq Scan', actualRows: 2, rowsRemoved: 3, loops: 4, children: [] })).toBe(
      20,
    );
    expect(rowsRead({ nodeType: 'Sort', actualRows: 2, loops: 1, children: [] })).toBeNull();
    expect(rowsRead({ nodeType: 'Seq Scan', children: [] })).toBeNull();
  });

  it('читает фактический план большого набора', async () => {
    await withDataset('big_bookstore', async (db) => {
      const plan = await inPreview(db, () => explainPlan(db, 'select * from orders where customer_id = 42'));
      expect(plan?.nodeType).toBe('Seq Scan');
      expect(plan?.actualRows).toBe(5);
      expect(plan && rowsRead(plan)).toBe(100000);
    });
  }, 120_000);

  it('не исполняет функции с побочными эффектами при построении плана', async () => {
    await withDataset('bookstore', async (db) => {
      await db.query('create sequence plan_test_seq');
      const plan = await inPreview(db, () => explainPlan(db, "select nextval('plan_test_seq')"));
      expect(plan).toBeNull();
      const value = await db.query('select last_value, is_called from plan_test_seq');
      expect(value.rows[0]).toEqual([1, false]);
      expect(await db.query('select 1')).toBeDefined();
    });
  });
  it('связывает план с однозначными стадиями и оставляет прежние уроки без плана', async () => {
    await withDataset('bookstore', async (db) => {
      const parsed = parseSql('select title from book where price > 100 order by title limit 2');
      if (!parsed.ok || !parsed.statements[0]) throw new Error('Запрос не разобран');
      const stmt = parsed.statements[0];
      const schema = await introspect(db);
      const plain = await inPreview(db, () => traceStatement(stmt, db, { schema }));
      expect(plain.plan).toBeUndefined();
      const trace = await inPreview(db, () => traceStatement(stmt, db, { schema, includePlan: true }));
      expect(trace.plan).toBeTruthy();
      if (!trace.plan) throw new Error('План не создан');
      const links = linkPlanToStages(trace.plan, trace.stages);
      const scan = links.find((link) => link.node.nodeType === 'Seq Scan');
      expect(scan?.stageIndex).not.toBeNull();
      expect(trace.stages[scan?.stageIndex ?? -1]?.kind).toBe('scan');
      const limit = links.find((link) => link.node.nodeType === 'Limit');
      expect(trace.stages[limit?.stageIndex ?? -1]?.kind).toBe('limit');
    });
  });

  it('отклоняет блокировки и запрос с изменением данных внутри WITH', async () => {
    await withDataset('bookstore', async (db) => {
      await inPreview(db, async () => {
        expect(await explainPlan(db, 'select * from book for update')).toBeNull();
        expect(
          await explainPlan(db, 'with x as (delete from book returning *) select count(*) from x'),
        ).toBeNull();
        expect((await db.query('select count(*) from book')).rows[0][0]).toBe(11);
      });
    });
  });
  it('связывает bitmap-индекс с таблицей родительского узла и не угадывает неоднозначные стадии', () => {
    const scan = bookScan();
    const bitmap = { nodeType: 'Bitmap Index Scan', indexName: 'book_idx', children: [] };
    const heap = {
      nodeType: 'Bitmap Heap Scan',
      relation: 'book',
      schema: 'public',
      alias: 'b',
      children: [bitmap],
    };
    expect(linkPlanToStages(heap, [scan]).map((item) => item.stageIndex)).toEqual([0, 0]);
    expect(linkPlanToStages(heap, [scan, { ...scan, id: 'second' }]).map((item) => item.stageIndex)).toEqual([
      null,
      null,
    ]);
  });
});
