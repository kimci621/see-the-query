// Golden-набор Ф10: запрос → ожидаемые стадии. Значения сняты прогоном на bookstore/events.
export const GOLDEN_F10: Array<{
  sql: string;
  stages: string;
  dataset: 'bookstore' | 'events';
}> = [
  {
    dataset: 'bookstore',
    sql: "select name from author where country = 'Россия' union select name from author where country = 'Франция' order by name",
    stages: 'setop:5 > sort:5',
  },
  {
    dataset: 'bookstore',
    sql: "select title from book where category_id = 3 intersect select title from book where tags @> '{приключения}' order by title",
    stages: 'setop:3 > sort:3',
  },
  {
    dataset: 'bookstore',
    sql: "select title from book where category_id = 3 except select title from book where title like '%Путешествие%' order by title",
    stages: 'setop:3 > sort:3',
  },
  {
    dataset: 'bookstore',
    sql: 'select rating from review where rating >= 5 union all select rating from review where rating >= 5',
    stages: 'setop:8',
  },
  {
    dataset: 'bookstore',
    sql: "with recent as (select * from orders where created_at >= '2024-05-01') select order_id, status from recent order by order_id",
    stages: 'materialize:2 > scan:2 > project:2 > sort:2',
  },
  {
    dataset: 'bookstore',
    sql: `with recursive tree as (
      select employee_id, name, manager_id, 1 as level from employee where manager_id is null
      union all
      select e.employee_id, e.name, e.manager_id, t.level + 1
      from employee e join tree t on e.manager_id = t.employee_id
    ) select employee_id, name, level from tree order by level, employee_id`,
    stages: 'recursion:8 > scan:8 > project:8 > sort:8',
  },
  {
    dataset: 'bookstore',
    sql: 'select title, (select max(price) from book) as max_price from book',
    stages: 'scan:11 > subquery:11 > project:11',
  },
  {
    dataset: 'bookstore',
    sql: 'select * from (select category_id, avg(price) as avg_price from book group by category_id) s where avg_price > 500 order by category_id nulls last',
    stages: 'materialize:4 > scan:4 > filter:4 > project:4 > sort:4',
  },
  {
    dataset: 'bookstore',
    sql: 'select title from book b where price > (select avg(price) from book where author_id = b.author_id) order by book_id',
    stages: 'scan:11 > subquery:11 > filter:2 > project:2 > sort:2',
  },
  {
    dataset: 'bookstore',
    sql: 'select title from book where category_id in (select category_id from book_category where parent_id = 1) order by book_id',
    stages: 'scan:11 > subquery:11 > filter:8 > project:8 > sort:8',
  },
  {
    dataset: 'bookstore',
    sql: 'select title from book b where exists (select 1 from review r where r.book_id = b.book_id) order by book_id',
    stages: 'scan:11 > subquery:11 > filter:7 > project:7 > sort:7',
  },
  {
    dataset: 'bookstore',
    sql: 'select title from book where price > any (select price from book where category_id = 3) order by book_id',
    stages: 'scan:11 > subquery:11 > filter:6 > project:6 > sort:6',
  },
  {
    dataset: 'bookstore',
    sql: 'select name, salary, row_number() over (order by salary desc) as rn from employee order by employee_id',
    stages: 'scan:8 > window:8 > project:8 > sort:8',
  },
  {
    dataset: 'events',
    sql: 'select kind, amount, lag(kind) over (order by happened_at) as prev, lead(kind) over (order by happened_at) as next from event where order_id = 7 order by happened_at',
    stages: 'scan:21 > filter:4 > window:4 > project:4 > sort:4',
  },
  {
    dataset: 'events',
    sql: "select order_id, kind, amount, sum(amount) over (order by happened_at) as total from event where kind = 'paid' order by happened_at",
    stages: 'scan:21 > filter:7 > window:7 > project:7 > sort:7',
  },
  {
    dataset: 'events',
    sql: 'select kind, count(*) over (order by happened_at rows between unbounded preceding and current row) as rows_cnt from event where order_id = 3 order by happened_at',
    stages: 'scan:21 > filter:3 > window:3 > project:3 > sort:3',
  },
  {
    dataset: 'events',
    sql: 'select kind, count(*) over (order by happened_at range between unbounded preceding and current row) as range_cnt from event where order_id = 3 order by happened_at',
    stages: 'scan:21 > filter:3 > window:3 > project:3 > sort:3',
  },
  {
    dataset: 'bookstore',
    sql: 'select category_id, count(*) from book group by rollup(category_id) order by grouping(category_id), category_id',
    stages: 'scan:11 > group:5 > project:5 > sort:5',
  },
  {
    dataset: 'bookstore',
    sql: 'select count(*) filter (where rating >= 5) as great, count(*) from review',
    stages: 'scan:10 > group:1 > project:1',
  },
  {
    dataset: 'bookstore',
    sql: "select title, case when price < 500 then 'дёшево' when price < 1000 then 'средне' else 'дорого' end as bucket from book order by bucket, title",
    stages: 'scan:11 > project:11 > sort:11',
  },
  {
    dataset: 'bookstore',
    sql: 'select a.name, t.title from author a, lateral (select title from book b where b.author_id = a.author_id order by price desc nulls last limit 1) t order by a.name',
    stages: 'scan:6 > project:6 > subquery:5 > sort:5',
  },
  {
    dataset: 'bookstore',
    sql: "select * from (values (1, 'a'), (2, 'b')) as t(n, s) order by n",
    stages: 'materialize:2 > scan:2 > project:2 > sort:2',
  },
  {
    dataset: 'bookstore',
    sql: 'select n, n * n as square from generate_series(1, 4) as n',
    stages: 'materialize:4 > scan:4 > project:4',
  },
];
