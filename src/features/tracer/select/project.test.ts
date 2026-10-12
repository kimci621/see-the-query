import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия project', () => {
  it('kept, removed, computed, renamed', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const project = stageOf(
          await traceSql(db, 'select title as name, price * 0.9 as sale, pages from book'),
          'project',
        );
        expect(project).toMatchObject({
          kept: ['pages'],
          removed: ['book_id', 'author_id', 'category_id', 'price', 'published_at', 'tags', 'meta'],
          computed: ['sale'],
          renamed: { title: 'name' },
          caption: 'SELECT: 2 колонки из 9, вычислено 1',
        });
        expect(project.output.columns[0]).toEqual({
          name: 'name',
          type: 'text',
          source: { alias: 'book', column: 'title' },
        });
        expect(column(project, 'sale')[0]).toBe('801.000');
      }),
    ));
  it('одноимённые колонки разных источников различаются по алиасу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const self = stageOf(
          await traceSql(
            db,
            'select c.name as child, p.name as parent from book_category c left join book_category p on c.parent_id = p.category_id',
          ),
          'project',
        );
        expect(self).toMatchObject({
          kept: [],
          removed: ['c.category_id', 'c.parent_id', 'p.category_id', 'p.parent_id'],
          renamed: { 'c.name': 'child', 'p.name': 'parent' },
          caption: 'SELECT: 2 колонки из 6',
        });
        const join = stageOf(
          await traceSql(
            db,
            'select b.author_id, a.name from book b join author a on b.author_id = a.author_id',
          ),
          'project',
        );
        expect(join.removed).toContain('a.author_id');
        expect(join.removed).not.toContain('b.author_id');
      }),
    ));
  it('одноимённые агрегаты: подпись считает обе колонки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const project = stageOf(
          await traceSql(db, 'select count(*) as total, count(price) as priced from book'),
          'project',
        );
        expect(project.removed).toEqual([]);
        expect(project.caption).toBe('SELECT: 2 колонки из 2');
      }),
    ));
  it('звёздочка с алиасом оставляет все колонки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const project = stageOf(
          await traceSql(db, 'select b.* from book b where b.price between 400 and 700'),
          'project',
        );
        expect(project.kept).toHaveLength(9);
        expect(project.removed).toEqual([]);
        expect(project.output.rows.map((r) => r.key)).toEqual(['b=(0,4)', 'b=(0,6)', 'b=(0,8)', 'b=(0,9)']);
      }),
    ));
  it('SELECT без FROM: одна строка из эталона', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select 2 + 2 as answer');
        expect(trace.mode).toBe('full');
        expect(trace.stages).toHaveLength(1);
        expect(stageOf(trace, 'project').output.rows).toEqual([{ key: 'r:0', lineage: {}, values: [4] }]);
      }),
    ));
});
