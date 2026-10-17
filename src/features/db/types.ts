export interface QueryField {
  name: string;
  dataTypeID: number;
}
export interface QueryResult {
  fields: QueryField[];
  rows: unknown[][]; // всегда rowMode: 'array'
  command?: string; // 'SELECT', 'INSERT', ...
  rowCount?: number;
}
// Число строк осмысленно только у этих команд; у DDL (CREATE, ALTER, DROP) PGlite отдаёт rowCount 0
export const hasRowCount = (command: string | undefined) =>
  command !== undefined && /^(SELECT|INSERT|UPDATE|DELETE|MERGE)$/.test(command);
export interface DbError {
  code: string; // SQLSTATE или наш код VS001/VS002
  message: string;
  detail?: string;
  hint?: string;
  position?: number; // 1-based позиция символа в исходном SQL
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
}
export class DbException extends Error {
  constructor(public readonly db: DbError) {
    super(db.message);
    this.name = 'DbException';
  }
}
export const SANDBOX_TIMEOUT = 'VS001'; // запрос превысил время
export const SANDBOX_CRASHED = 'VS002'; // worker упал

export interface DbClient {
  query(sql: string, params?: unknown[]): Promise<QueryResult>; // один оператор
  exec(sql: string): Promise<QueryResult[]>; // несколько операторов
  dump(): Promise<Blob>;
  version(): Promise<string>; // select version()
  close(): Promise<void>;
}
