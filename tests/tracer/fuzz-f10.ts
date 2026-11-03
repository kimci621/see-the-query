// Детерминированный генератор запросов Ф10 по bookstore: множества, CTE, подзапросы, окна,
// CASE, ROLLUP, FILTER, LATERAL, VALUES. Каждый шаблон заведомо валиден по схеме датасета

interface Rnd {
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
}

function mulberry32(seed: number): Rnd {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
  };
}

const PRICES = ['price > 500', 'price < 1500', 'price is null', 'price between 300 and 900', 'price > 1000'];
const COUNTRIES = ["country = 'Россия'", "country = 'Франция'", 'country is null'];
const CATEGORIES = [3, 4, 6];
const RATINGS = [3, 4, 5];
const AMOUNTS = [350, 500, 900];

function genQuery(rnd: Rnd): string {
  const price = rnd.pick(PRICES);
  const country = rnd.pick(COUNTRIES);
  const category = rnd.pick(CATEGORIES);
  const rating = rnd.pick(RATINGS);
  const amount = rnd.pick(AMOUNTS);
  const limit = rnd.int(1, 8);
  const template = rnd.int(0, 19);
  switch (template) {
    case 0:
      return `select title from book where ${price} union select name from author where ${country}`;
    case 1:
      return `select title from book where ${price} union all select name from author where ${country}`;
    case 2:
      return `select title from book where ${price} intersect select title from book where pages > ${rnd.int(100, 500)}`;
    case 3:
      return `select title from book except select title from book where ${price}`;
    case 4:
      return `with t as (select book_id, title, price from book where ${price}) select title, price from t order by price desc nulls last limit ${limit}`;
    case 5:
      return `with recursive t as (
        select employee_id, name, manager_id from employee where manager_id is null
        union all
        select e.employee_id, e.name, e.manager_id from employee e join t on e.manager_id = t.employee_id
      ) select employee_id, name from t order by employee_id`;
    case 6:
      return `select title from book where author_id in (select author_id from author where ${country})`;
    case 7:
      return 'select name from author where author_id not in (select author_id from book)';
    case 8:
      return `select title from book b where exists (select 1 from review r where r.book_id = b.book_id and r.rating >= ${rating})`;
    case 9:
      return `select title from book b where price > (select avg(price) from book where category_id = ${category})`;
    case 10:
      return `select title, row_number() over (partition by category_id order by price desc nulls last) as rn from book`;
    case 11:
      return 'select name, salary, sum(salary) over (partition by position order by salary) as total from employee';
    case 12:
      return 'select category_id, count(*) from book group by rollup(category_id)';
    case 13:
      return `select count(*) filter (where rating >= ${rating}) as great, count(*) from review`;
    case 14:
      return `select title, case when price < ${amount} then 'дешёво' when price < 1000 then 'средне' else 'дорого' end as bucket from book`;
    case 15:
      return `select a.name, t.title from author a, lateral (
        select title from book b where b.author_id = a.author_id order by price desc nulls last limit 1
      ) t`;
    case 16:
      return `select distinct on (author_id) title, author_id from book order by author_id, price desc nulls last`;
    case 17:
      return `select n, n * n from generate_series(1, ${rnd.int(2, 9)}) as n`;
    case 18:
      return `select n, s from (values (1, 'a'), (2, 'b'), (3, 'c')) as t(n, s) where n > ${rnd.int(0, 2)}`;
    default:
      return `select * from (select category_id, avg(price) as avg_price from book group by category_id) s where avg_price > ${amount}`;
  }
}

export function fuzzF10Queries(seed: number, count: number): string[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => genQuery(rnd));
}
