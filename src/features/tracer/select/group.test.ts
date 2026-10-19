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
  it('ключ-ключевое слово: deparser берёт в кавычки, подпись без кавычек', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select position, count(*) from employee group by position');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const group = stageOf(trace, 'group');
        expect(group.keys).toEqual(['"position"']);
        expect(group.caption).toBe('GROUP BY position: 8 строк → 6 групп');
      }),
    ));
  it('keyColumns: колонки входа под ключом, у выражения и алиаса из SELECT тоже', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const cases: Array<[string, string[]]> = [
          ['select author_id, count(*) from book group by author_id', ['book.author_id']],
          ['select lower(title), count(*) from book group by lower(title)', ['book.title']],
          [
            "select date_trunc('month', created_at), count(*) from customer group by date_trunc('month', created_at)",
            ['customer.created_at'],
          ],
          [
            "select date_trunc('month', created_at) as m, count(*) from customer group by m",
            ['customer.created_at'],
          ],
          ['select position, count(*) from employee group by 1', ['employee.position']],
          [
            'select a.author_id, a.name, count(b.book_id) from author a left join book b on a.author_id = b.author_id group by a.author_id, a.name',
            ['a.author_id', 'a.name'],
          ],
        ];
        for (const [sql, keys] of cases) {
          for (const maxRows of [undefined, 5]) {
            const trace = await traceSql(db, sql, maxRows ? { maxRows } : {});
            expect(trace.mode, `${sql}: ${trace.fallbackReason}`).toBe('full');
            const group = stageOf(trace, 'group');
            const input = trace.stages[trace.stages.indexOf(group) - 1].output.columns;
            const named = group.keyColumns.map((i) => `${input[i].source?.alias}.${input[i].name}`);
            expect(named, `${sql}, maxRows ${maxRows}`).toEqual(keys);
          }
        }
      }),
    ));
  it('колонки агрегатов на стадии group под алиасами из SELECT, а не под именами Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sql =
          'select a.name, count(*) as all_rows, count(b.book_id) as books from author a left join book b on a.author_id = b.author_id group by a.author_id, a.name';
        for (const maxRows of [undefined, 5]) {
          const trace = await traceSql(db, sql, maxRows ? { maxRows } : {});
          expect(trace.mode, `${trace.fallbackReason}, maxRows ${maxRows}`).toBe('full');
          const group = stageOf(trace, 'group');
          expect(group.output.columns.map((c) => c.name)).toEqual(['author_id', 'name', 'all_rows', 'books']);
          expect(stageOf(trace, 'project').renamed).toEqual({});
        }
      }),
    ));
  it('aggregateColumns и nullSkipColumns: колонки входа внутри агрегатов по AST', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const cases: Array<[string, string[], string[]]> = [
          ['select count(*) from book', [], []],
          [
            'select count(price), max(title) from book',
            ['book.price', 'book.title'],
            ['book.price', 'book.title'],
          ],
          ["select country, string_agg(name, ', ') from author group by country", ['author.name'], []],
          [
            'select a.name, count(*) as all_rows, count(b.book_id) as books from author a left join book b on a.author_id = b.author_id group by a.author_id, a.name',
            ['b.book_id'],
            ['b.book_id'],
          ],
        ];
        for (const [sql, inside, skip] of cases) {
          // Сжатый агрегат без GROUP BY пока уходит в final-only (P8.55), сжатый режим только с GROUP BY
          for (const maxRows of sql.includes('group by') ? [undefined, 5] : [undefined]) {
            const trace = await traceSql(db, sql, maxRows ? { maxRows } : {});
            expect(trace.mode, `${sql}: ${trace.fallbackReason}`).toBe('full');
            const group = stageOf(trace, 'group');
            const input = trace.stages[trace.stages.indexOf(group) - 1].output.columns;
            const named = (cols: number[]) => cols.map((i) => `${input[i].source?.alias}.${input[i].name}`);
            expect(named(group.aggregateColumns), `${sql}, maxRows ${maxRows}`).toEqual(inside);
            expect(named(group.nullSkipColumns), `${sql}, maxRows ${maxRows}`).toEqual(skip);
          }
        }
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
  it('агрегат без GROUP BY: значения набегают по строкам в порядке стопки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const group = stageOf(await traceSql(db, 'select count(*), count(price) from book'), 'group');
        const running = group.running ?? [];
        expect(running).toHaveLength(group.groups[0].members.length);
        expect(running.map((v) => v[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(running.at(-1)).toEqual([11, 10]);
        // строка с NULL в price: count(*) растёт, count(price) стоит
        expect(running.some((v, j) => j > 0 && v[1] === running[j - 1][1])).toBe(true);
      }),
    ));
  it('агрегат, который не считается окном (DISTINCT), остаётся без набегания', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(distinct author_id) from book');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(stageOf(trace, 'group').running).toBeUndefined();
        expect(
          stageOf(await traceSql(db, 'select author_id, count(*) from book group by 1'), 'group').running,
        ).toBeUndefined();
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
        expect(project.renamed).toEqual({}); // агрегат уже назван алиасом на стадии group
        const i = column(group, 'author_id').indexOf(1);
        expect(column(group, 'total')[i]).toBe('1240.00'); // 890 + 350;
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

describe('стадия having', () => {
  it('HAVING: фильтр по группам, вердикты по g:N', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select author_id, count(*) from book group by author_id having count(*) > 1',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > filter:5 > project:5');
        const filter = stageOf(trace, 'filter');
        expect(filter.clause).toBe('having');
        expect(filter.verdicts['g:1']).toBe(false); // author 2: одна книга
        expect(Object.values(filter.verdicts).filter((v) => v === true)).toHaveLength(5);
        expect(filter.predicateColumns).toEqual(['count']);
        expect(filter.caption).toBe('HAVING: осталось 5 из 6 групп');
      }),
    ));
  it('HAVING по ключу: NULL-группа проходит отдельно', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select author_id, count(*) from book group by author_id having author_id is null',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > filter:1 > project:1');
        expect(column(stageOf(trace, 'filter'), 'count')).toEqual([2]);
      }),
    ));
  it('HAVING после join, затем ORDER BY', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country having count(*) >= 2 order by count(*)',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > group:3 > filter:2 > project:2 > sort:2');
        expect(column(stageOf(trace, 'sort'), 'country')).toEqual(['Франция', 'Россия']);
      }),
    ));
  it('HAVING без GROUP BY и в сжатом режиме', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const none = await traceSql(db, 'select count(*) from book having count(*) > 100');
        expect(none.mode, none.fallbackReason).toBe('full');
        expect(summary(none)).toBe('scan:11 > group:1 > filter:0 > project:0');
        const big = await traceSql(
          db,
          'select author_id, count(*) from book group by author_id having count(*) > 1',
          { maxRows: 5 },
        );
        expect(big.mode, big.fallbackReason).toBe('full');
        expect(summary(big)).toBe('scan:11 > group:6 > filter:5 > project:5');
      }),
    ));
});
