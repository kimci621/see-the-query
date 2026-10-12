import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, summary, traceSql } from '../../../../tests/helpers/trace';

describe('стадия group', () => {
  it('GROUP BY: группы, NULL-ключ в своей группе, значения агрегатов', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, count(*) from book group by author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6');
        const group = stageOf(trace, 'group');
        expect(group.keys).toEqual(['author_id']);
        expect(group.aggregates).toEqual(['count(*)']);
        expect(group.groups).toHaveLength(6);
        const nullGroup = group.groups.find(
          (g) => column(group, 'author_id')[Number(g.key.slice(2))] === null,
        );
        expect(nullGroup?.members).toEqual(['book=(0,10)', 'book=(0,11)']);
        expect(column(group, 'count')).toEqual([2, 1, 2, 2, 2, 2]); // ORDER BY author_id, NULL последняя
        expect(group.output.rows.map((r) => r.key)).toEqual(['g:0', 'g:1', 'g:2', 'g:3', 'g:4', 'g:5']);
      }),
    ));
  it('агрегат без GROUP BY: одна строка даже на пустом входе', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*) from book where price > 9000');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > filter:0 > group:1 > project:1');
        const group = stageOf(trace, 'group');
        expect(group.keys).toEqual([]);
        expect(group.groups).toEqual([{ key: 'g:0', members: [] }]);
        expect(column(group, 'count')).toEqual([0]);
      }),
    ));
  it('count(*) vs count(col): NULL не считается', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*), count(price) from book');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const group = stageOf(trace, 'group');
        expect(group.output.rows.map((r) => r.values)).toEqual([[11, 10]]);
      }),
    ));
  it('выражение над агрегатами: значения из пробы P, агрегаты в списке стадии', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select author_id, sum(price) as total, round(avg(price), 2) as avg_price from book group by author_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6');
        const group = stageOf(trace, 'group');
        expect(group.aggregates).toEqual(['sum(price)', 'avg(price)']);
        const project = stageOf(trace, 'project');
        expect(project.computed).toEqual(['avg_price']);
        expect(project.renamed).toEqual({ sum: 'total' });
        const i = column(group, 'author_id').indexOf(1);
        expect(column(group, 'sum')[i]).toBe('1240.00'); // 890 + 350;
      }),
    ));
  it('group после join: члены группы с составными ключами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > group:3 > project:3');
        const group = stageOf(trace, 'group');
        expect(group.groups.every((g) => g.members.every((m) => /^b=\(0,\d+\)\|a=\(0,\d+\)$/.test(m)))).toBe(
          true,
        );
        expect(column(group, 'count')).toEqual([1, 6, 2]); // ORDER BY country: Бразилия, Россия, Франция
      }),
    ));
  it('GROUP BY по номеру и по имени выхода, ORDER BY и LIMIT над группами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        for (const sql of [
          'select author_id, count(*) as n from book group by 1 order by n desc, author_id limit 2',
          'select coalesce(author_id, 0) as a, count(*) as n from book group by a order by n desc, a limit 2',
        ]) {
          const trace = await traceSql(db, sql);
          expect(trace.mode, `${sql}: ${trace.fallbackReason}`).toBe('full');
          expect(summary(trace)).toBe('scan:11 > group:6 > project:6 > sort:6 > limit:2');
        }
      }),
    ));
  it('DISTINCT над группами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select distinct count(*) from book group by author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6 > distinct:2');
      }),
    ));
  it('сжатый режим: группа со счётчиком', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, count(*) from book group by author_id', {
          maxRows: 5,
        });
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6');
      }),
    ));
});
