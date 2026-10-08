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
