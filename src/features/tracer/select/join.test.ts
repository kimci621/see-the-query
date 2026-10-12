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
  it('RIGHT JOIN: у строки без пары слева NULL-ctid, пара [null, right]', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select a.name, b.title from author a right join book b on a.author_id = b.author_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:6 > scan:11 > join:11 > project:11');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({ joinType: 'right', leftAliases: ['a'], rightAlias: 'b' });
        // две книги без автора: левая половина NULL
        expect(join.pairs).toContainEqual([null, 'b=(0,10)']);
        expect(join.pairs).toContainEqual([null, 'b=(0,11)']);
        const noPair = join.output.rows.find((r) => r.key === 'a=∅|b=(0,10)');
        expect(noPair?.lineage).toEqual({ a: null, b: '(0,10)' });
        expect(join.caption).toBe('RIGHT JOIN: 9 пар, 2 строки справа без пары');
      }),
    ));
  it('FULL JOIN: NULL с обеих сторон, 12 строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, a.name from book b full join author a on b.author_id = a.author_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:12 > project:12');
        const join = stageOf(trace, 'join');
        expect(join.joinType).toBe('full');
        expect(join.pairs).toContainEqual(['b=(0,10)', null]);
        expect(join.pairs).toContainEqual([null, 'a=(0,6)']); // Пастернак без книг
        expect(join.output.rows.find((r) => r.key === 'b=∅|a=(0,6)')?.values.slice(9)).toEqual([
          6,
          'Борис Пастернак',
          'Россия',
          1890,
        ]);
      }),
    ));
  it('CROSS JOIN: сетка всех пар и подпись N × M', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, c.name from book b cross join customer c');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:66 > project:66');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({ joinType: 'cross', onColumns: [], usingColumns: [] });
        expect(join.pairs).toHaveLength(66);
        expect(new Set(join.pairs.map(([l]) => l)).size).toBe(11); // каждый left ровно 6 раз
        expect(join.pairs).toContainEqual(['b=(0,1)', 'c=(0,1)']);
        expect(join.caption).toBe('CROSS JOIN: 11 × 6 = 66 строк');
      }),
    ));
  it('запятая в FROM - это CROSS JOIN', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, c.name from book b, customer c');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:66 > project:66');
        expect(stageOf(trace, 'join').joinType).toBe('cross');
      }),
    ));
  it('сложный FROM честно уходит в final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const nested = await traceSql(
          db,
          'select b.title from book b join (author a join book b2 on a.author_id = b2.author_id) on b.book_id = b2.book_id',
        );
        expect(nested).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: сложный FROM',
        });
        const commaJoin = await traceSql(
          db,
          'select c.name from customer c, book b join author a on b.author_id = a.author_id',
        );
        expect(commaJoin).toMatchObject({
          mode: 'final-only',
          fallbackReason: 'Пока не анимируется: сложный FROM',
        });
      }),
    ));
});

describe('стадия join: цепочки и SELF JOIN', () => {
  it('цепочка из 4 таблиц: три join-стадии с промежуточными результатами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, c.name, o.order_id from orders o join order_item oi on o.order_id = oi.order_id join book b on oi.book_id = b.book_id join customer c on o.customer_id = c.customer_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(
          'scan:8 > scan:15 > scan:11 > scan:6 > join:15 > join:15 > join:15 > project:15',
        );
        const joins = trace.stages.flatMap((s) => (s.kind === 'join' ? [s] : []));
        expect(joins.map((j) => j.leftAliases)).toEqual([['o'], ['o', 'oi'], ['o', 'oi', 'b']]);
        expect(joins[1].pairs[0][0]).toMatch(/^o=\(0,\d+\)\|oi=\(0,\d+\)$/);
        // колонки с одинаковыми именами различаются источником
        const orderIds = joins[2].output.columns.filter((c) => c.name === 'order_id');
        expect(orderIds.map((c) => c.source?.alias)).toEqual(['o', 'oi']);
        expect(trace.result?.rows).toHaveLength(15);
      }),
    ));
  it('SELF JOIN: две копии employee, ключи строк различаются алиасами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select e.name, m.name from employee e join employee m on e.manager_id = m.employee_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:8 > scan:8 > join:7 > project:7');
        const join = stageOf(trace, 'join');
        expect(join.onColumns).toEqual(['e.manager_id', 'm.employee_id']);
        expect(join.pairs).toContainEqual(['e=(0,2)', 'm=(0,1)']);
        expect(join.output.rows.find((r) => r.key === 'e=(0,2)|m=(0,1)')?.values[2]).toBe(1); // e.manager_id
        expect(trace.stages.flatMap((s) => (s.kind === 'scan' ? [s.alias] : []))).toEqual(['e', 'm']);
        // e.name и m.name в выходе: обе колонки с источником
        expect(stageOf(trace, 'project').output.columns.map((c) => c.source)).toEqual([
          { alias: 'e', column: 'name' },
          { alias: 'm', column: 'name' },
        ]);
      }),
    ));
  it('цепочка с LEFT JOIN посередине: NULL-половина не теряет левую часть', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select b.title, a.name, c.name from book b left join author a on b.author_id = a.author_id join book_category c on b.category_id = c.category_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const joins = trace.stages.flatMap((s) => (s.kind === 'join' ? [s] : []));
        // книга без автора доходит до второго join с левым ключом 'b=…|a=∅'
        expect(joins[1].pairs.some(([l]) => l === 'b=(0,11)|a=∅')).toBe(true);
      }),
    ));
});
