// Golden-набор Ф5: запрос → ожидаемые стадии. Значения сняты прогоном на bookstore (PGlite 0.5.8).
// Ф8 добавляет сюда запросы уроков главы 4, Ф7 и Ф10 свои.
export const GOLDEN: Array<{ sql: string; stages: string }> = [
  { sql: 'select * from book', stages: 'scan:11 > project:11' },
  { sql: 'select title, price from book', stages: 'scan:11 > project:11' },
  { sql: 'select title as name, price * 0.9 as sale from book', stages: 'scan:11 > project:11' },
  { sql: 'select title, price from book where price > 500', stages: 'scan:11 > filter:7 > project:7' },
  {
    sql: 'select title, price from book where price > 500 or pages < 100',
    stages: 'scan:11 > filter:9 > project:9',
  },
  { sql: 'select * from book where author_id is null', stages: 'scan:11 > filter:2 > project:2' },
  { sql: 'select * from book where price = null', stages: 'scan:11 > filter:0 > project:0' },
  { sql: "select * from customer where city <> 'Москва'", stages: 'scan:6 > filter:3 > project:3' },
  { sql: "select name, coalesce(city, 'не указан') as city from customer", stages: 'scan:6 > project:6' },
  { sql: 'select title, price from book order by price', stages: 'scan:11 > project:11 > sort:11' },
  {
    sql: 'select title, price from book order by price desc nulls last',
    stages: 'scan:11 > project:11 > sort:11',
  },
  { sql: 'select title, price from book order by 2 desc, title', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title from book order by price desc nulls last', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price * 2 as p from book order by p', stages: 'scan:11 > project:11 > sort:11' },
  {
    sql: 'select title, price from book order by price desc nulls last limit 3',
    stages: 'scan:11 > project:11 > sort:11 > limit:3',
  },
  {
    sql: 'select title, price from book order by price limit 3 offset 2',
    stages: 'scan:11 > project:11 > sort:11 > limit:3',
  },
  {
    sql: 'select title, price from book order by price fetch first 3 rows with ties',
    stages: 'scan:11 > project:11 > sort:11 > limit:3',
  },
  { sql: 'select title from book limit 3', stages: 'scan:11 > project:11 > limit:3' },
  { sql: 'select title from book offset 9', stages: 'scan:11 > project:11 > limit:2' },
  { sql: 'select * from book limit all', stages: 'scan:11 > project:11 > limit:11' },
  { sql: 'select * from book limit 0', stages: 'scan:11 > project:11 > limit:0' },
  { sql: 'select distinct city from customer', stages: 'scan:6 > project:6 > distinct:4' },
  {
    sql: 'select distinct city from customer order by city',
    stages: 'scan:6 > project:6 > distinct:4 > sort:4',
  },
  {
    sql: 'select distinct on (category_id) title, category_id, price from book order by category_id, price desc',
    stages: 'scan:11 > project:11 > distinct:4 > sort:4',
  },
  { sql: 'select distinct name from customer', stages: 'scan:6 > project:6 > distinct:5' },
  { sql: 'select 2 + 2 as answer', stages: 'project:1' },
  { sql: 'select title, random() as r from book', stages: 'scan:11 > project:11' },
  { sql: 'select title from book order by random()', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title from book order by price, random()', stages: 'scan:11 > project:11 > sort:11' },
  {
    sql: 'select title, price from book order by price desc nulls last, lower(title), random()',
    stages: 'scan:11 > project:11 > sort:11',
  },
  {
    sql: "select title, upper(title), length(title) from book where title ilike '%python%'",
    stages: 'scan:11 > filter:3 > project:3',
  },
  {
    sql: 'select b.* from book b where b.price between 400 and 700',
    stages: 'scan:11 > filter:4 > project:4',
  },
  {
    sql: 'select title, price from book where price in (350, 610) order by price, title',
    stages: 'scan:11 > filter:4 > project:4 > sort:4',
  },
  {
    sql: "select name from customer where city is distinct from 'Москва'",
    stages: 'scan:6 > filter:4 > project:4',
  },
  { sql: 'select title from book where not (price > 1000)', stages: 'scan:11 > filter:7 > project:7' },
  {
    sql: 'select title, pages from book order by pages desc limit 2 offset 1',
    stages: 'scan:11 > project:11 > sort:11 > limit:2',
  },
  { sql: 'select title from book as "B"', stages: 'scan:11 > project:11' },
  {
    sql: "select * from public.book b where b.title like '%Python%' order by b.price desc",
    stages: 'scan:11 > filter:3 > project:3 > sort:3',
  },
  {
    sql: 'select title, price from book order by price nulls first limit 2',
    stages: 'scan:11 > project:11 > sort:11 > limit:2',
  },
  {
    sql: 'select title from book where pages > 300 and price < 1000 order by title desc offset 1 limit 2',
    stages: 'scan:11 > filter:3 > project:3 > sort:3 > limit:2',
  },
  {
    sql: 'select distinct on (author_id) author_id, title from book order by author_id, published_at desc',
    stages: 'scan:11 > project:11 > distinct:6 > sort:6',
  },
  { sql: 'select now() as t, title from book limit 2', stages: 'scan:11 > project:11 > limit:2' },
  {
    sql: 'select title, price from book order by price desc fetch first 1 row with ties',
    stages: 'scan:11 > project:11 > sort:11 > limit:1',
  },
  {
    sql: 'select title, price from book order by price fetch first 1 row with ties',
    stages: 'scan:11 > project:11 > sort:11 > limit:2',
  },
  {
    sql: 'select price from book order by price limit 5',
    stages: 'scan:11 > project:11 > sort:11 > limit:5',
  },
  {
    sql: 'select title from book order by price limit 1',
    stages: 'scan:11 > project:11 > sort:11 > limit:1',
  },
  {
    sql: 'select title from book order by price limit 4 offset 1',
    stages: 'scan:11 > project:11 > sort:11 > limit:4',
  },
  {
    sql: 'select title from book order by category_id limit 2',
    stages: 'scan:11 > project:11 > sort:11 > limit:2',
  },
  {
    sql: 'select name from employee order by salary limit 2',
    stages: 'scan:8 > project:8 > sort:8 > limit:2',
  },
  {
    sql: 'select name from employee order by salary desc limit 6',
    stages: 'scan:8 > project:8 > sort:8 > limit:6',
  },
  {
    sql: 'select distinct on (category_id) category_id, title from book order by category_id',
    stages: 'scan:11 > project:11 > distinct:4 > sort:4',
  },
  { sql: 'select distinct on (city) city, name from customer', stages: 'scan:6 > project:6 > distinct:4' },
  {
    sql: 'select distinct on (author_id) author_id, title from book',
    stages: 'scan:11 > project:11 > distinct:6',
  },
  { sql: 'select distinct city from customer limit 2', stages: 'scan:6 > project:6 > distinct:4 > limit:2' },
  { sql: 'select title from book limit 3 offset 4', stages: 'scan:11 > project:11 > limit:3' },
  {
    sql: 'select distinct on (price) price, title from book order by price',
    stages: 'scan:11 > project:11 > distinct:9 > sort:9',
  },
  { sql: 'select title, upper(title) from book order by upper', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, title from book order by 1', stages: 'scan:11 > project:11 > sort:11' },
  // P8.34: ключ квалифицированным именем и выражением
  { sql: 'select b.title, b.price from book b order by b.price', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price from book order by lower(title)', stages: 'scan:11 > project:11 > sort:11' },
  {
    sql: "select * from book order by meta->>'lang', title limit 3",
    stages: 'scan:11 > project:11 > sort:11 > limit:3',
  },
];

// Golden-набор Ф7: JOIN всех видов, GROUP BY, агрегаты, HAVING
export const GOLDEN_F7: Array<{ sql: string; stages: string }> = [
  {
    sql: 'select b.title, a.name from book b join author a on b.author_id = a.author_id',
    stages: 'scan:11 > scan:6 > join:9 > project:9',
  },
  {
    sql: 'select b.title, a.name from book b left join author a on b.author_id = a.author_id',
    stages: 'scan:11 > scan:6 > join:11 > project:11',
  },
  {
    sql: 'select a.name, b.title from author a right join book b on a.author_id = b.author_id',
    stages: 'scan:6 > scan:11 > join:11 > project:11',
  },
  {
    sql: 'select b.title, a.name from book b full join author a on b.author_id = a.author_id',
    stages: 'scan:11 > scan:6 > join:12 > project:12',
  },
  {
    sql: 'select b.title, c.name from book b cross join customer c',
    stages: 'scan:11 > scan:6 > join:66 > project:66',
  },
  {
    sql: 'select b.title, c.name from book b, customer c limit 10',
    stages: 'scan:11 > scan:6 > join:66 > project:66 > limit:10',
  },
  {
    sql: 'select * from book b join author a using (author_id)',
    stages: 'scan:11 > scan:6 > join:9 > project:9',
  },
  {
    sql: 'select b.title, a.name from book b natural join author a',
    stages: 'scan:11 > scan:6 > join:9 > project:9',
  },
  {
    sql: 'select e.name, m.name from employee e join employee m on e.manager_id = m.employee_id',
    stages: 'scan:8 > scan:8 > join:7 > project:7',
  },
  {
    sql: 'select b.title, c.name, o.order_id from orders o join order_item oi on o.order_id = oi.order_id join book b on oi.book_id = b.book_id join customer c on o.customer_id = c.customer_id',
    stages: 'scan:8 > scan:15 > scan:11 > scan:6 > join:15 > join:15 > join:15 > project:15',
  },
  {
    sql: "select b.title from book b join author a on b.author_id = a.author_id where a.country = 'Россия'",
    stages: 'scan:11 > scan:6 > join:9 > filter:6 > project:6',
  },
  {
    sql: 'select b.title from book b left join author a on b.author_id = a.author_id and a.country is null',
    stages: 'scan:11 > scan:6 > join:11 > project:11',
  },
  { sql: 'select author_id, count(*) from book group by author_id', stages: 'scan:11 > group:6 > project:6' },
  { sql: 'select count(*), count(price) from book', stages: 'scan:11 > group:1 > project:1' },
  {
    sql: 'select author_id, sum(price) as total from book group by author_id order by total desc',
    stages: 'scan:11 > group:6 > project:6 > sort:6',
  },
  {
    sql: 'select author_id, count(*) from book group by author_id having count(*) > 1',
    stages: 'scan:11 > group:6 > filter:5 > project:5',
  },
  {
    sql: 'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country order by count(*) desc limit 2',
    stages: 'scan:11 > scan:6 > join:9 > group:3 > project:3 > sort:3 > limit:2',
  },
  {
    sql: 'select c.name, count(*) from customer c left join orders o on c.customer_id = o.customer_id group by c.name order by count(*) desc',
    stages: 'scan:6 > scan:8 > join:9 > group:5 > project:5 > sort:5',
  },
  {
    sql: 'select o.status, sum(oi.qty * oi.price) from orders o join order_item oi on o.order_id = oi.order_id group by o.status',
    stages: 'scan:8 > scan:15 > join:15 > group:4 > project:4',
  },
  // P8.34: ключ выражением и алиасом выражения из SELECT
  {
    sql: 'select lower(title), count(*) from book group by lower(title)',
    stages: 'scan:11 > group:11 > project:11',
  },
  {
    sql: "select date_trunc('month', created_at) as m, count(*) from customer group by m",
    stages: 'scan:6 > group:5 > project:5',
  },
  // P8.44: агрегаты под алиасами уже на стадии group
  {
    sql: 'select a.name, count(*) as all_rows, count(b.book_id) as books from author a left join book b on a.author_id = b.author_id group by a.author_id, a.name',
    stages: 'scan:6 > scan:11 > join:10 > group:6 > project:6',
  },
];
