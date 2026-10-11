import type { Node } from '@pgsql/types';

export type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'merge' | 'ddl' | 'tcl' | 'other';

export interface ParsedStatement {
  index: number;
  from: number; // символьные позиции в полном тексте, to не включительно
  to: number;
  byteFrom: number; // байтовое начало оператора в полном тексте: location узлов AST абсолютны, переводим через него
  text: string; // исходный текст оператора без завершающей ';'
  ast: Node;
  kind: StatementKind;
}

export type ParseOutcome =
  | { ok: true; statements: ParsedStatement[] }
  | { ok: false; error: { message: string; position: number /* символьная, 0-based */ } };

export interface RangeRef {
  schema: string | null;
  name: string;
  alias: string | null;
  from: number;
  to: number;
}

export interface ColumnRef {
  qualifier: string | null;
  name: string;
  from: number;
  to: number;
}

export interface Relations {
  tables: RangeRef[];
  columns: ColumnRef[];
}

export type ClauseName =
  | 'with'
  | 'select'
  | 'from'
  | 'where'
  | 'group'
  | 'having'
  | 'window'
  | 'order'
  | 'limit'
  | 'offset'
  | 'values'
  | 'set'
  | 'returning'
  | 'on_conflict'
  | 'using'
  | 'into';

export interface ClauseRange {
  clause: ClauseName;
  from: number;
  to: number;
}
