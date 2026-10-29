import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { diffSchemas } from './diff';

const table = (id: string, type = 'integer'): TableInfo => {
  const [schema, name] = id.split('.');
  return {
    id,
    schema,
    name,
    kind: 'table',
    columns: [
      {
        name: 'id',
        type,
        nullable: false,
        default: null,
        isPk: false,
        isUnique: false,
        isGenerated: false,
        identity: null,
        checks: [],
        fk: null,
      },
    ],
    rowCount: 0,
    sampleRows: [],
    sampleCtids: [],
    indexes: [],
    constraints: [],
    comment: null,
  };
};

const schema = (tables: TableInfo[], schemas = ['public']): SchemaSnapshot => ({
  schemas,
  tables,
  fks: [],
  sequences: [],
});

describe('diffSchemas', () => {
  it('отличает таблицы, типы, NOT NULL, индексы и схемы', () => {
    const before = schema([table('public.author'), table('public.old')]);
    before.tables[0].columns[0].nullable = true;
    const author = table('public.author', 'bigint');
    author.indexes = [{ name: 'author_id_idx', definition: 'create index', unique: false, primary: false }];
    const after = schema([author, table('public.book')], ['public', 'shop']);
    const diff = diffSchemas(before, after, { columns: [], tables: [] });
    expect(diff.addedTables).toEqual(['public.book']);
    expect(diff.droppedTables).toEqual(['public.old']);
    expect(diff.alteredColumns).toEqual([
      { tableId: 'public.author', column: 'id', before: 'integer', after: 'bigint' },
    ]);
    expect(diff.addedConstraints).toContainEqual({
      tableId: 'public.author',
      name: 'id_not_null',
      kind: 'n',
      columns: ['id'],
    });
    expect(diff.addedIndexes).toEqual([{ tableId: 'public.author', name: 'author_id_idx' }]);
    expect(diff.addedSchemas).toEqual(['shop']);
  });

  it('переименование таблицы не выглядит как drop и create', () => {
    const diff = diffSchemas(schema([table('public.author')]), schema([table('public.writer')]), {
      columns: [],
      tables: [{ from: 'public.author', to: 'public.writer' }],
    });
    expect(diff.addedTables).toEqual([]);
    expect(diff.droppedTables).toEqual([]);
    expect(diff.renamedTables).toEqual([{ from: 'public.author', to: 'public.writer' }]);
  });
});
