import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Relation, Row, Stage, Trace } from '@/features/tracer/types';
import type { AnimatorContext } from '../types';

const bookColumns = [
  { name: 'book_id', type: 'int8', source: { alias: 'b', column: 'book_id' } },
  { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
  { name: 'price', type: 'numeric', source: { alias: 'b', column: 'price' } },
];

const row = (ctid: string, values: unknown[]): Row => ({ key: `b=${ctid}`, lineage: { b: ctid }, values });

// Пять книг: одна без цены (NULL), одна дешёвая
export const BOOKS: Row[] = [
  row('(0,1)', [1, 'Тихий Дон', '890.00']),
  row('(0,2)', [2, 'Python. К вершинам мастерства', '2400.00']),
  row('(0,3)', [3, 'Судьба человека', '350.00']),
  row('(0,7)', [7, 'Остров погибших кораблей', null]),
  row('(0,8)', [8, 'Путешествие к центру Земли', '610.00']),
];

export function bookScan(): Extract<Stage, { kind: 'scan' }> {
  return {
    id: 's0',
    kind: 'scan',
    alias: 'b',
    tableId: 'public.book',
    caption: 'FROM book: 5 строк',
    output: { columns: bookColumns, rows: BOOKS },
  };
}

const pick = (keys: string[]) => keys.map((k) => BOOKS.find((r) => r.key === k) as Row);

// select title, price, price * 0.9 as sale from book b where price > 500 order by price desc limit 2
export function fullPipelineTrace(): Trace {
  const afterWhere: Relation = { columns: bookColumns, rows: pick(['b=(0,1)', 'b=(0,2)', 'b=(0,8)']) };
  const projColumns = [
    { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
    { name: 'price', type: 'numeric', source: { alias: 'b', column: 'price' } },
    { name: 'sale', type: 'numeric' },
  ];
  const proj = (k: string, title: string, price: string, sale: string): Row => ({
    key: k,
    lineage: { b: k.slice(2) },
    values: [title, price, sale],
  });
  const projected: Row[] = [
    proj('b=(0,1)', 'Тихий Дон', '890.00', '801.000'),
    proj('b=(0,2)', 'Python. К вершинам мастерства', '2400.00', '2160.000'),
    proj('b=(0,8)', 'Путешествие к центру Земли', '610.00', '549.000'),
  ];
  const sorted = [projected[1], projected[0], projected[2]];
  const stages: Stage[] = [
    bookScan(),
    {
      id: 's1',
      kind: 'filter',
      clause: 'where',
      predicateColumns: ['price'],
      verdicts: { 'b=(0,1)': true, 'b=(0,2)': true, 'b=(0,3)': false, 'b=(0,7)': null, 'b=(0,8)': true },
      caption: 'WHERE price > 500: осталось 3 из 5',
      output: afterWhere,
    },
    {
      id: 's2',
      kind: 'project',
      kept: ['title', 'price'],
      removed: ['book_id'],
      computed: ['sale'],
      renamed: {},
      caption: 'SELECT: 3 колонки',
      output: { columns: projColumns, rows: projected },
    },
    {
      id: 's3',
      kind: 'sort',
      order: sorted.map((r) => r.key),
      sortKeys: ['price DESC'],
      caption: 'ORDER BY price DESC',
      output: { columns: projColumns, rows: sorted },
    },
    {
      id: 's4',
      kind: 'limit',
      kept: ['b=(0,2)', 'b=(0,1)'],
      cut: ['b=(0,8)'],
      limit: 2,
      offset: 0,
      caption: 'LIMIT 2: осталось 2 из 3',
      output: { columns: projColumns, rows: sorted.slice(0, 2) },
    },
  ];
  return {
    sql: 'select title, price, price * 0.9 as sale from book b where price > 500 order by price desc limit 2',
    statementType: 'select',
    mode: 'full',
    touched: { tableIds: ['public.book'], columns: ['public.book.price'] },
    stages,
    result: null,
    error: null,
    notices: [],
    timingMs: 12,
  };
}

// select distinct price from book b (только цены, у двух книг цена 610)
export function distinctTrace(): Trace {
  const priceCol = [{ name: 'price', type: 'numeric' }];
  const r = (k: string, p: string | null): Row => ({ key: k, lineage: { b: k.slice(2) }, values: [p] });
  const projected = [
    r('b=(0,1)', '890.00'),
    r('b=(0,8)', '610.00'),
    r('b=(0,9)', '610.00'),
    r('b=(0,7)', null),
  ];
  const scanRows: Row[] = projected.map((p, i) => ({ ...p, values: [i, `книга ${i}`, p.values[0]] }));
  const stages: Stage[] = [
    { ...bookScan(), output: { columns: bookColumns, rows: scanRows }, caption: 'FROM book: 4 строки' },
    {
      id: 's1',
      kind: 'project',
      kept: ['price'],
      removed: ['book_id', 'title'],
      computed: [],
      renamed: {},
      caption: 'SELECT price',
      output: { columns: priceCol, rows: projected },
    },
    {
      id: 's2',
      kind: 'distinct',
      on: null,
      stacks: [
        { winner: 'b=(0,1)', members: ['b=(0,1)'] },
        { winner: 'b=(0,8)', members: ['b=(0,8)', 'b=(0,9)'] },
        { winner: 'b=(0,7)', members: ['b=(0,7)'] },
      ],
      caption: 'DISTINCT: 3 уникальных из 4',
      output: { columns: priceCol, rows: [projected[0], projected[1], projected[3]] },
    },
  ];
  return { ...fullPipelineTrace(), sql: 'select distinct price from book b', stages };
}

// Большая стадия: n строк, WHERE оставляет чётные
export function bigFilterTrace(n: number): Trace {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({
    key: `b=(${Math.floor(i / 100)},${(i % 100) + 1})`,
    lineage: { b: `(${Math.floor(i / 100)},${(i % 100) + 1})` },
    values: [i, `книга ${i}`, String(i)],
  }));
  const verdicts: Record<string, boolean> = {};
  rows.forEach((r, i) => {
    verdicts[r.key] = i % 2 === 0;
  });
  const kept = rows.filter((_, i) => i % 2 === 0);
  const stages: Stage[] = [
    { ...bookScan(), output: { columns: bookColumns, rows }, caption: `FROM book: ${n} строк` },
    {
      id: 's1',
      kind: 'filter',
      clause: 'where',
      predicateColumns: ['price'],
      verdicts,
      caption: `WHERE: осталось ${kept.length} из ${n}`,
      output: { columns: bookColumns, rows: kept },
    },
  ];
  return { ...fullPipelineTrace(), stages };
}

// Сжатый режим Ф5: таблица больше maxRows, строк в стадиях нет, только точный rowCount
export function compressedTrace(n: number): Trace {
  const stages: Stage[] = [
    {
      ...bookScan(),
      output: { columns: bookColumns, rows: [] },
      compressed: true,
      rowCount: n,
      caption: `FROM book: ${n} строк`,
    },
    {
      id: 's1',
      kind: 'filter',
      clause: 'where',
      predicateColumns: [],
      verdicts: {},
      compressed: true,
      rowCount: n / 2,
      caption: `WHERE: осталось ${n / 2} из ${n}`,
      output: { columns: bookColumns, rows: [] },
    },
  ];
  return { ...fullPipelineTrace(), stages };
}

export const EMPTY_SCHEMA: SchemaSnapshot = { schemas: ['public'], tables: [], fks: [], sequences: [] };

// Контекст аниматоров для тестов: book стоит в (0, 0), рабочая зона справа
export function testCtx(
  rects: Record<string, { x: number; y: number; width: number; height: number }> = {
    'public.book': { x: 0, y: 0, width: 260, height: 400 },
  },
): AnimatorContext {
  return { nodeRect: (id) => rects[id] ?? null, workArea: { x: 500, y: 0 }, schema: EMPTY_SCHEMA };
}

// select b.title, a.name from book b <тип> join author a on b.author_id = a.author_id (4 книги, 3 автора)
const bCols = [
  { name: 'book_id', type: 'int8', source: { alias: 'b', column: 'book_id' } },
  { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
  { name: 'author_id', type: 'int8', source: { alias: 'b', column: 'author_id' } },
];
const aCols = [
  { name: 'author_id', type: 'int8', source: { alias: 'a', column: 'author_id' } },
  { name: 'name', type: 'text', source: { alias: 'a', column: 'name' } },
];
const bRow = (ctid: string, id: number, title: string, author: number | null): Row => ({
  key: `b=${ctid}`,
  lineage: { b: ctid },
  values: [id, title, author],
});
const aRow = (ctid: string, id: number, name: string): Row => ({
  key: `a=${ctid}`,
  lineage: { a: ctid },
  values: [id, name],
});
const JOIN_BOOKS = [
  bRow('(0,1)', 1, 'Тихий Дон', 1),
  bRow('(0,3)', 3, 'Судьба человека', 1),
  bRow('(0,4)', 4, 'Капитанская дочка', 3),
  bRow('(0,10)', 10, 'Простой Python', null),
];
const JOIN_AUTHORS = [
  aRow('(0,1)', 1, 'Михаил Шолохов'),
  aRow('(0,3)', 3, 'Александр Пушкин'),
  aRow('(0,6)', 6, 'Борис Пастернак'),
];
const joined = (b: Row | null, a: Row | null): Row => ({
  key: `${b?.key ?? 'b=∅'}|${a?.key ?? 'a=∅'}`,
  lineage: { b: b?.lineage.b ?? null, a: a?.lineage.a ?? null },
  values: [...(b?.values ?? [null, null, null]), ...(a?.values ?? [null, null])],
});
const MATCHED: Array<[Row, Row]> = [
  [JOIN_BOOKS[0], JOIN_AUTHORS[0]],
  [JOIN_BOOKS[1], JOIN_AUTHORS[0]],
  [JOIN_BOOKS[2], JOIN_AUTHORS[1]],
];

export function joinTrace(joinType: 'inner' | 'left' | 'right' | 'full' = 'inner'): Trace {
  const lonelyLeft = joinType === 'left' || joinType === 'full' ? [JOIN_BOOKS[3]] : [];
  const lonelyRight = joinType === 'right' || joinType === 'full' ? [JOIN_AUTHORS[2]] : [];
  const rows = [
    ...MATCHED.map(([b, a]) => joined(b, a)),
    ...lonelyLeft.map((b) => joined(b, null)),
    ...lonelyRight.map((a) => joined(null, a)),
  ];
  const pairs: Array<[string | null, string | null]> = [
    ...MATCHED.map(([b, a]): [string, string] => [b.key, a.key]),
    ...lonelyLeft.map((b): [string, null] => [b.key, null]),
    ...lonelyRight.map((a): [null, string] => [null, a.key]),
  ];
  const stages: Stage[] = [
    {
      id: 's0',
      kind: 'scan',
      alias: 'b',
      tableId: 'public.book',
      caption: 'FROM book AS b: 4 строки',
      output: { columns: bCols, rows: JOIN_BOOKS },
    },
    {
      id: 's1',
      kind: 'scan',
      alias: 'a',
      tableId: 'public.author',
      caption: 'FROM author AS a: 3 строки',
      output: { columns: aCols, rows: JOIN_AUTHORS },
    },
    {
      id: 's2',
      kind: 'join',
      joinType,
      leftAliases: ['b'],
      rightAlias: 'a',
      pairs,
      onColumns: ['b.author_id', 'a.author_id'],
      usingColumns: [],
      caption: `${joinType.toUpperCase()} JOIN: 3 пары`,
      output: { columns: [...bCols, ...aCols], rows },
    },
    {
      id: 's3',
      kind: 'project',
      kept: ['title', 'name'],
      removed: ['book_id', 'author_id', 'author_id'],
      computed: [],
      renamed: {},
      caption: 'SELECT: 2 колонки из 5',
      output: {
        columns: [bCols[1], aCols[1]],
        rows: rows.map((r) => ({ ...r, values: [r.values[1], r.values[4]] })),
      },
    },
  ];
  return {
    sql: `select b.title, a.name from book b ${joinType} join author a on b.author_id = a.author_id`,
    statementType: 'select',
    mode: 'full',
    touched: { tableIds: ['public.book', 'public.author'], columns: [] },
    stages,
    result: null,
    error: null,
    notices: [],
    timingMs: 10,
  };
}

// select b.title, c.name from book b cross join customer c: n книг × m покупателей
export function crossJoinTrace(n = 3, m = 2): Trace {
  const books = Array.from({ length: n }, (_, i) => bRow(`(0,${i + 1})`, i + 1, `Книга ${i + 1}`, null));
  const cCols = [{ name: 'name', type: 'text', source: { alias: 'c', column: 'name' } }];
  const customers: Row[] = Array.from({ length: m }, (_, i) => ({
    key: `c=(0,${i + 1})`,
    lineage: { c: `(0,${i + 1})` },
    values: [`Покупатель ${i + 1}`],
  }));
  const rows: Row[] = books.flatMap((b) =>
    customers.map((c) => ({
      key: `${b.key}|${c.key}`,
      lineage: { b: b.lineage.b, c: c.lineage.c },
      values: [...b.values, ...c.values],
    })),
  );
  const stages: Stage[] = [
    {
      id: 's0',
      kind: 'scan',
      alias: 'b',
      tableId: 'public.book',
      caption: `FROM book AS b: ${n}`,
      output: { columns: bCols, rows: books },
    },
    {
      id: 's1',
      kind: 'scan',
      alias: 'c',
      tableId: 'public.customer',
      caption: `FROM customer AS c: ${m}`,
      output: { columns: cCols, rows: customers },
    },
    {
      id: 's2',
      kind: 'join',
      joinType: 'cross',
      leftAliases: ['b'],
      rightAlias: 'c',
      pairs: rows.map((r): [string, string] => [`b=${r.lineage.b}`, `c=${r.lineage.c}`]),
      onColumns: [],
      usingColumns: [],
      caption: `CROSS JOIN: ${n} × ${m} = ${n * m}`,
      output: { columns: [...bCols, ...cCols], rows },
    },
  ];
  return { ...joinTrace(), sql: 'select * from book b cross join customer c', stages };
}
