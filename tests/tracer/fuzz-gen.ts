// Детерминированный генератор запросов по bookstore: JOIN / WHERE / GROUP BY / HAVING / ORDER BY / LIMIT.
// Соединения только по FK, предикаты из пула, при GROUP BY в SELECT только ключ и агрегаты

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

// [таблица, колонка, ссылается на таблицу, колонку]
const FKS: Array<[string, string, string, string]> = [
  ['book', 'author_id', 'author', 'author_id'],
  ['book', 'category_id', 'book_category', 'category_id'],
  ['orders', 'customer_id', 'customer', 'customer_id'],
  ['order_item', 'order_id', 'orders', 'order_id'],
  ['order_item', 'book_id', 'book', 'book_id'],
  ['review', 'book_id', 'book', 'book_id'],
  ['review', 'customer_id', 'customer', 'customer_id'],
];

// Условия WHERE по имени колонки, без квалификатора
const PRED: Record<string, string[]> = {
  price: ['price > 500', 'price < 1500', 'price is null', 'price between 300 and 900'],
  pages: ['pages > 300', 'pages < 200'],
  author_id: ['author_id is null', 'author_id is not null'],
  category_id: ['category_id is null'],
  country: ["country = 'Россия'", "country is distinct from 'Россия'"],
  born_year: ['born_year > 1850'],
  city: ['city is null', "city = 'Москва'"],
  bonus: ['bonus > 0'],
  status: ["status = 'paid'", "status in ('new', 'paid')"],
  qty: ['qty > 1'],
  rating: ['rating between 2 and 4', 'rating >= 4'],
  salary: ['salary > 100000'],
  manager_id: ['manager_id is null', 'manager_id is not null'],
};

const NUM_COLS: Record<string, string[]> = {
  book: ['price', 'pages'],
  author: ['born_year'],
  book_category: [],
  customer: ['bonus'],
  orders: [],
  order_item: ['qty', 'price'],
  employee: ['salary'],
  review: ['rating'],
};

const ALL_COLS: Record<string, string[]> = {
  book: ['book_id', 'title', 'author_id', 'category_id', 'price', 'pages', 'published_at', 'tags', 'meta'],
  author: ['author_id', 'name', 'country', 'born_year'],
  book_category: ['category_id', 'name', 'parent_id'],
  customer: ['customer_id', 'name', 'email', 'city', 'bonus', 'settings', 'created_at'],
  orders: ['order_id', 'customer_id', 'status', 'created_at'],
  order_item: ['order_id', 'book_id', 'qty', 'price'],
  employee: ['employee_id', 'name', 'manager_id', 'position', 'salary', 'hired_at'],
  review: ['review_id', 'book_id', 'customer_id', 'rating', 'body', 'created_at'],
};

const JOIN_KW = { inner: 'join', left: 'left join', right: 'right join', full: 'full join' } as const;

export function fuzzQueries(seed: number, count: number): string[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => genQuery(rnd));
}

function genQuery(rnd: Rnd): string {
  const rels = [{ table: rnd.pick(Object.keys(ALL_COLS)), alias: 't0' }];
  const joins: string[] = [];
  for (let j = 1, n = rnd.int(0, 3); j <= n; j++) {
    const has = (t: string) => rels.some((r) => r.table === t);
    const candidates = FKS.filter(([a, , b]) => has(a) !== has(b));
    if (!candidates.length) break;
    const [a, aCol, b, bCol] = rnd.pick(candidates);
    // Новая таблица: та сторона FK, которой ещё нет
    const [newTable, newCol, oldTable, oldCol] = has(a) ? [b, bCol, a, aCol] : [a, aCol, b, bCol];
    const oldAlias = rels.find((r) => r.table === oldTable)?.alias ?? 't0';
    const rel = `${newTable} t${j}`;
    const type = rnd.pick(['inner', 'inner', 'left', 'left', 'right', 'full', 'cross'] as const);
    // Запятая связывает слабее JOIN: ON следующего соединения не увидел бы t0, поэтому только при одном соединении
    if (type === 'cross') joins.push(n === 1 && rnd.chance(0.5) ? `, ${rel}` : ` cross join ${rel}`);
    else if (newCol === oldCol && rnd.chance(0.3)) joins.push(` ${JOIN_KW[type]} ${rel} using (${newCol})`);
    else joins.push(` ${JOIN_KW[type]} ${rel} on ${oldAlias}.${oldCol} = t${j}.${newCol}`);
    rels.push({ table: newTable, alias: `t${j}` });
  }
  const from = `${rels[0].table} t0${joins.join('')}`;

  const wheres: string[] = [];
  for (let w = rnd.int(0, 2); w > 0; w--) {
    const rel = rnd.pick(rels);
    const cols = Object.keys(PRED).filter((c) => ALL_COLS[rel.table].includes(c));
    if (cols.length) wheres.push(`${rel.alias}.${rnd.pick(PRED[rnd.pick(cols)])}`);
  }

  let targets: string[];
  let group = '';
  if (rnd.chance(0.4)) {
    const rel = rnd.pick(rels);
    const key = `${rel.alias}.${rnd.pick(ALL_COLS[rel.table])}`;
    const nums = NUM_COLS[rel.table];
    targets = [key, rnd.chance(0.5) || !nums.length ? 'count(*)' : `count(${rel.alias}.${rnd.pick(nums)})`];
    if (nums.length && rnd.chance(0.5))
      targets.push(`${rnd.pick(['sum', 'avg', 'min', 'max'])}(${rel.alias}.${rnd.pick(nums)})`);
    group = ` group by ${key}${rnd.chance(0.3) ? ` having count(*) > ${rnd.int(1, 3)}` : ''}`;
  } else {
    const all = rels.flatMap((r) => ALL_COLS[r.table].map((c) => `${r.alias}.${c}`));
    targets = Array.from({ length: rnd.int(1, 4) }, () => rnd.pick(all));
  }

  const order: string[] = [];
  if (rnd.chance(0.5)) {
    order.push(
      `${group ? '1' : rnd.pick(rels.flatMap((r) => ALL_COLS[r.table].map((c) => `${r.alias}.${c}`)))}${rnd.chance(0.4) ? ' desc' : ''}`,
    );
    if (targets.length > 1 && rnd.chance(0.3)) order.push('2');
  }
  return [
    `select ${targets.join(', ')} from ${from}`,
    wheres.length ? ` where ${wheres.join(' and ')}` : '',
    group,
    order.length ? ` order by ${order.join(', ')}` : '',
    rnd.chance(0.3) ? ` limit ${rnd.int(1, 15)}` : '',
  ].join('');
}
