import { describe, expect, it } from 'vitest';
import type { ColumnInfo, SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { buildSchemaSpec } from './completion';

const col = (name: string): ColumnInfo => ({
  name,
  type: 'text',
  nullable: true,
  default: null,
  isPk: false,
  isUnique: false,
  isGenerated: false,
  identity: null,
  checks: [],
  fk: null,
});

const table = (id: string, names: string[]): TableInfo => {
  const [schema = 'public', name = id] = id.split('.');
  return {
    id,
    schema,
    name,
    kind: 'table',
    columns: names.map(col),
    rowCount: 0,
    sampleRows: [],
    sampleCtids: [],
    indexes: [],
    constraints: [],
    comment: null,
  };
};

const SCHEMA: SchemaSnapshot = {
  schemas: ['public', 'shop'],
  tables: [table('public.book', ['book_id', 'title', 'price']), table('shop.cart', ['cart_id', 'book_id'])],
  fks: [],
  sequences: [],
};

// та же схема плюс таблица с конфликтующим именем book в другой схеме
const SCHEMA_CONFLICT: SchemaSnapshot = {
  ...SCHEMA,
  schemas: ['public', 'shop', 'archive'],
  tables: [...SCHEMA.tables, table('archive.book', ['id'])],
};

describe('buildSchemaSpec', () => {
  it('таблицы с полным id и коротким именем, колонки списком', () => {
    const spec = buildSchemaSpec(SCHEMA);
    expect(spec['public.book']).toEqual(['book_id', 'title', 'price']);
    expect(spec['shop.cart']).toEqual(['cart_id', 'book_id']);
    expect(spec.book).toEqual(['book_id', 'title', 'price']);
    expect(spec.cart).toEqual(['cart_id', 'book_id']);
  });

  it('короткое имя не добавляется при конфликте имён в разных схемах', () => {
    const spec = buildSchemaSpec(SCHEMA_CONFLICT);
    // book есть в public и archive: короткого ключа быть не должно
    expect(Object.keys(spec)).not.toContain('book');
    expect(Object.keys(spec)).toEqual(expect.arrayContaining(['public.book', 'shop.cart', 'archive.book']));
    // cart не конфликтует, короткое имя остаётся
    expect(spec.cart).toEqual(['cart_id', 'book_id']);
  });

  it('пустая схема даёт пустую спецификацию', () => {
    expect(buildSchemaSpec({ schemas: ['public'], tables: [], fks: [], sequences: [] })).toEqual({});
  });
});
