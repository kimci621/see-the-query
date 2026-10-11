import type { ColumnInfo, FkAction, FkInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';

export function col(name: string, type: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    type,
    nullable: true,
    default: null,
    isPk: false,
    isUnique: false,
    isGenerated: false,
    identity: null,
    checks: [],
    fk: null,
    ...extra,
  };
}

export function table(id: string, columns: ColumnInfo[], rows: unknown[][] = [], rowCount = rows.length): TableInfo {
  const [schema = 'public', name = id] = id.split('.');
  return {
    id,
    schema,
    name,
    kind: 'table',
    columns,
    rowCount,
    sampleRows: rows,
    sampleCtids: rows.map((_, i) => `(0,${i + 1})`),
    indexes: [],
    comment: null,
  };
}

export function fk(name: string, from: string, fromCol: string, to: string, toCol: string, onDelete: FkAction = 'NO ACTION'): FkInfo {
  return { name, from: { tableId: from, columns: [fromCol] }, to: { tableId: to, columns: [toCol] }, onDelete, onUpdate: 'NO ACTION' };
}

const ref = (t: string, c: string) => ({ schema: t.split('.')[0] ?? 'public', table: t.split('.')[1] ?? t, column: c });

export const author = table(
  'public.author',
  [col('author_id', 'bigint', { isPk: true, nullable: false, identity: 'always' }), col('name', 'text', { nullable: false }), col('country', 'text')],
  [
    [1, 'Михаил Шолохов', 'Россия'],
    [2, 'Лусиану Рамальо', 'Бразилия'],
    [6, 'Борис Пастернак', null],
  ],
);

export const category = table(
  'public.book_category',
  [
    col('category_id', 'integer', { isPk: true, nullable: false }),
    col('name', 'text', { nullable: false, isUnique: true }),
    col('parent_id', 'integer', { fk: ref('public.book_category', 'category_id') }),
  ],
  [[1, 'Художественная литература', null]],
);

// 11 строк в таблице, в выборке 3: проверяем «+ ещё 8», NULL и пустую строку
export const book = table(
  'public.book',
  [
    col('book_id', 'bigint', { isPk: true, nullable: false }),
    col('title', 'text', { nullable: false }),
    col('author_id', 'bigint', { fk: ref('public.author', 'author_id') }),
    col('category_id', 'integer', { fk: ref('public.book_category', 'category_id') }),
    col('price', 'numeric(10,2)', { checks: ['CHECK ((price >= (0)::numeric))'] }),
    col('published_at', 'date', { default: 'CURRENT_DATE' }),
  ],
  [
    [1, 'Тихий Дон', 1, 4, '890.00', new Date(Date.UTC(1940, 0, 1))],
    [7, 'Остров погибших кораблей', 4, 3, null, new Date(Date.UTC(1926, 0, 1))],
    [12, '', null, null, '0.00', null],
  ],
  11,
);

export const cart = table(
  'shop.cart',
  [col('cart_id', 'bigint', { isPk: true, nullable: false }), col('book_id', 'bigint', { fk: ref('public.book', 'book_id') })],
  [],
  0,
);

export const SCHEMA: SchemaSnapshot = {
  schemas: ['public', 'shop'],
  tables: [author, category, book, cart],
  fks: [
    fk('book_author_id_fkey', 'public.book', 'author_id', 'public.author', 'author_id'),
    fk('book_category_id_fkey', 'public.book', 'category_id', 'public.book_category', 'category_id'),
    fk('book_category_parent_id_fkey', 'public.book_category', 'parent_id', 'public.book_category', 'category_id'),
    fk('cart_book_id_fkey', 'shop.cart', 'book_id', 'public.book', 'book_id', 'CASCADE'),
  ],
  sequences: [],
};
