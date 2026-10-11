import type { SchemaSnapshot } from '@/features/db/introspect';
import type { DbError, QueryResult } from '@/features/db/types';
import type { StatementKind } from '@/features/sql/types';

export type Lineage = Record<string, string | null>;
export type RowKey = string;

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
}

export interface StageBase {
  id: string;
  sourceRange?: SourceRange;
  caption: string;
  output: Relation;
  volatile?: boolean;
  compressed?: boolean;
}

// Ф5 сузит до union контракта
export type Stage = StageBase & Record<string, unknown>;

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
  before: SchemaSnapshot | null;
  after: SchemaSnapshot | null;
}

export interface Trace {
  sql: string;
  statementType: StatementKind;
  mode: 'full' | 'final-only';
  fallbackReason?: string;
  touched: { tableIds: string[]; columns: string[] };
  stages: Stage[];
  result: QueryResult | null;
  error: DbError | null;
  notices: string[];
  timingMs: number;
}
