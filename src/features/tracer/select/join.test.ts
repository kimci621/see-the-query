import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, summary, traceSql } from '../../../../tests/helpers/trace';

describe('стадия join: INNER и LEFT', () => {
  it('INNER JOIN: сканы обеих таблиц, пары, клоны, строки без пары не в результате', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, a.name from book b join author a on b.author_id = a.author_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > project:9');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({
          joinType: 'inner',
          leftAliases: ['b'],
          rightAlias: 'a',
          onColumns: ['b.author_id', 'a.author_id'],
          usingColumns: [],
        });
        expect(join.pairs).toContainEqual(['b=(0,1)', 'a=(0,1)']);
        // Шолохов (a=(0,1)) написал две книги: строка a клонируется на две пары
        expect(join.pairs.filter(([, r]) => r === 'a=(0,1)').map(([l]) => l)).toEqual(['b=(0,1)', 'b=(0,3)']);
        // «Простой Python» и «Изучаем Python» без автора; Пастернак без книг
        expect(join.pairs.every(([, r]) => r !== 'a=(0,6)')).toBe(true);
        expect(trace.result?.rows).toHaveLength(9);
      }),
    ));
  it('LEFT JOIN: строка без пары получает NULL-половину в lineage', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, a.name from book b left join author a on b.author_id = a.author_id',
        );
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:11 > project:11');
        const join = stageOf(trace, 'join');
        expect(join.joinType).toBe('left');
        expect(join.pairs).toContainEqual(['b=(0,10)', null]);
        expect(join.pairs).toContainEqual(['b=(0,11)', null]);
        const noPair = join.output.rows.find((r) => r.key === 'b=(0,10)|a=∅');
        expect(noPair?.lineage).toEqual({ b: '(0,10)', a: null });
        expect(noPair?.values).toHaveLength(13); // 9 колонок book + 4 author
        expect(join.output.columns.map((c) => c.source?.alias)).toEqual([...'bbbbbbbbb', ...'aaaa']);
      }),
    ));
  it('WHERE после join фильтрует строки уже соединённые', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          "select b.title from book b join author a on b.author_id = a.author_id where a.country = 'Россия'",
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > filter:6 > project:6');
        expect(column(stageOf(trace, 'filter'), 'country')).toEqual(Array(6).fill('Россия'));
      }),
    ));
  it('JOIN с DISTINCT, ORDER BY и LIMIT проходит сверку', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select distinct a.name from book b join author a on b.author_id = a.author_id order by a.name limit 3',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > project:9 > distinct:5 > sort:5 > limit:3');
      }),
    ));
  it('сжатый режим: join-стадия только со счётчиком строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, a.name from book b join author a on b.author_id = a.author_id where a.born_year > 1900',
          { maxRows: 5 },
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > filter:3 > project:3');
        expect(trace.stages.every((s) => s.compressed && s.output.rows.length === 0)).toBe(true);
        expect(stageOf(trace, 'join').output.columns).toHaveLength(13);
      }),
    ));
  it('right / full / cross пока честно уходят в final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const right = await traceSql(
          db,
          'select a.name from author a right join book b on a.author_id = b.author_id',
        );
        expect(right).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: RIGHT JOIN',
        });
        const cross = await traceSql(db, 'select b.title from book b, customer c');
        expect(cross).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: CROSS JOIN',
        });
      }),
    ));
});
