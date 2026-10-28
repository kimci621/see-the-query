import type { SchemaSnapshot } from '@/features/db/introspect';
import type { DbError, QueryResult } from '@/features/db/types';
import type { StatementKind } from '@/features/sql/types';

export type Lineage = Record<string, string | null>; // алиас → ctid ('(0,3)') или null
export type RowKey = string; // см. rowkey.ts
export interface Column {
  name: string;
  type: string;
  source?: { alias: string; column: string };
}
export interface Row {
  key: RowKey;
  lineage: Lineage;
  values: unknown[];
}
export interface Relation {
  columns: Column[];
  rows: Row[];
}
export interface SourceRange {
  from: number;
  to: number;
} // символьные позиции в полном тексте редактора

export interface StageBase {
  id: string;
  sourceRange?: SourceRange;
  caption: string;
  output: Relation;
  volatile?: boolean;
  compressed?: boolean;
  rowCount?: number; // точное число строк стадии; в сжатом режиме output.rows пуст
}
export type Stage = StageBase &
  (
    | { kind: 'scan'; alias: string; tableId: string }
    | {
        kind: 'join';
        joinType: 'inner' | 'left' | 'right' | 'full' | 'cross';
        leftAliases: string[];
        rightAlias: string;
        pairs: Array<[RowKey | null, RowKey | null]>;
        onColumns: string[];
        usingColumns: string[];
      }
    | {
        kind: 'filter';
        clause: 'where' | 'having';
        verdicts: Record<RowKey, true | false | null>;
        predicateColumns: string[];
      }
    | {
        kind: 'group';
        keys: string[];
        keyColumns: number[]; // номера колонок входа стадии под ключами: их оверлей подсвечивает
        groups: Array<{ key: RowKey; members: RowKey[] }>;
        aggregates: string[];
        aggregateColumns: number[]; // номера колонок входа внутри агрегатов: их оверлей не перечёркивает
        nullSkipColumns: number[]; // колонки входа count(col), sum(col) и т. п.: NULL в них не засчитывается
        running?: unknown[][]; // без GROUP BY: значения агрегатов после каждого члена стопки
      }
    | { kind: 'window'; partitions: Array<{ members: RowKey[] }>; computed: string[]; frame?: string }
    | {
        kind: 'project';
        kept: string[];
        removed: string[];
        computed: string[];
        renamed: Record<string, string>;
      }
    | { kind: 'distinct'; on: string[] | null; stacks: Array<{ winner: RowKey; members: RowKey[] }> }
    | { kind: 'sort'; order: RowKey[]; sortKeys: string[]; keyColumns: number[] } // keyColumns: номера колонок выхода под ключами
    | {
        kind: 'limit';
        kept: RowKey[];
        cut: RowKey[];
        limit: number | null;
        offset: number;
        withTies: boolean;
      }
    | {
        kind: 'setop';
        op: 'union' | 'union all' | 'intersect' | 'intersect all' | 'except' | 'except all';
        branches: [Trace, Trace];
      }
    | { kind: 'materialize'; name: string; inner: Trace }
    | { kind: 'recursion'; name: string; iterations: Relation[] }
    | {
        kind: 'subquery';
        mode: 'scalar' | 'in' | 'exists' | 'correlated' | 'lateral';
        samples: Array<{ outer: RowKey; inner: Trace }>;
      }
    | {
        kind: 'dml';
        op: 'insert' | 'update' | 'delete' | 'merge' | 'truncate';
        tableId: string;
        inserted: RowKey[];
        deleted: RowKey[];
        updated: Array<{ key: RowKey; before: unknown[]; after: unknown[]; changedColumns: string[] }>;
        conflicts: Array<{ key: RowKey; action: 'nothing' | 'update' }>;
        mergeBranches: Record<RowKey, 'matched_update' | 'matched_delete' | 'not_matched_insert' | 'skipped'>;
        cascades: Array<{ tableId: string; deleted: RowKey[]; updated: RowKey[] }>;
        // Колонки, которые заполнила база: DEFAULT, identity, генерируемые
        defaulted?: string[];
      }
    | { kind: 'ddl'; diff: SchemaDiff }
    | {
        kind: 'error';
        error: DbError;
        focus: { tableIds: string[]; columns: string[] };
        // 42803 «must appear»: состав групп, чтобы показать колонку вне GROUP BY в стопке
        group?: { keys: string[]; keyColumns: number[]; groups: Array<{ key: RowKey; members: RowKey[] }> };
        attempted?: Relation;
        conflictKeys?: RowKey[];
      }
  );

export interface SchemaDiff {
  addedTables: string[];
  droppedTables: string[];
  addedColumns: Array<{ tableId: string; column: string }>;
  droppedColumns: Array<{ tableId: string; column: string }>;
  renamedColumns: Array<{ tableId: string; from: string; to: string }>;
  alteredColumns: Array<{ tableId: string; column: string; before: string; after: string }>;
  addedConstraints: Array<{
    tableId: string;
    name: string;
    kind: 'p' | 'f' | 'u' | 'c' | 'n';
    columns: string[];
  }>;
  droppedConstraints: Array<{ tableId: string; name: string }>;
  addedIndexes: Array<{ tableId: string; name: string }>;
  droppedIndexes: Array<{ tableId: string; name: string }>;
  addedSchemas: string[];
  droppedSchemas: string[];
  renamedTables: Array<{ from: string; to: string }>;
  before: SchemaSnapshot;
  after: SchemaSnapshot;
}

export interface Trace {
  sql: string;
  statementType: StatementKind;
  mode: 'full' | 'final-only';
  fallbackReason?: string;
  // expanded (таблицы под звёздочкой) считает редактор: трассировщику он не нужен
  touched: { tableIds: string[]; columns: string[]; expanded?: string[] };
  stages: Stage[];
  result: QueryResult | null;
  error: DbError | null;
  notices: string[];
  timingMs: number;
}

export interface TraceOptions {
  signal?: AbortSignal;
  maxRows?: number;
  schema: SchemaSnapshot;
}
