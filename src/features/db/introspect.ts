import type { DbClient } from './types';

export type FkAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPk: boolean;
  isUnique: boolean;
  isGenerated: boolean;
  identity: 'always' | 'by default' | null;
  checks: string[]; // текст CHECK, упоминающих колонку
  fk: { schema: string; table: string; column: string } | null;
}
export interface IndexInfo {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
}
export interface TableInfo {
  id: string; // 'public.book': ключ таблицы везде в приложении
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'matview' | 'partitioned' | 'temp';
  columns: ColumnInfo[];
  rowCount: number;
  sampleRows: unknown[][]; // первые N строк, порядок по ctid
  sampleCtids: string[]; // ctid строк sampleRows; у view и matview 'row:<i>'
  sampleXmins?: string[]; // xmin строк sampleRows (только таблицы): по нему доска находит строки «Применить»
  indexes: IndexInfo[];
  comment: string | null;
}
export interface FkInfo {
  name: string;
  from: { tableId: string; columns: string[] };
  to: { tableId: string; columns: string[] };
  onDelete: FkAction;
  onUpdate: FkAction;
}
export interface SchemaSnapshot {
  schemas: string[];
  tables: TableInfo[];
  fks: FkInfo[];
  sequences: Array<{ schema: string; name: string; lastValue: number | null }>;
}

// Пользовательские схемы: без системных и toast
const NS = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'`;
const FK_ACTIONS: Record<string, FkAction> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};
const KINDS: Record<string, TableInfo['kind']> = { r: 'table', v: 'view', m: 'matview', p: 'partitioned' };

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
// у временных таблиц схема pg_temp_N; в приложении она всегда pg_temp
const schemaName = (s: string) => (s.startsWith('pg_temp_') ? 'pg_temp' : s);

type TableRow = [
  oid: number,
  schema: string,
  name: string,
  relkind: string,
  persistence: string,
  populated: boolean,
  comment: string | null,
];
type ColumnRow = [
  oid: number,
  name: string,
  type: string,
  nullable: boolean,
  def: string | null,
  identity: string,
  generated: string,
];
type ConstraintRow = [
  oid: number,
  name: string,
  type: string,
  cols: string[],
  refOid: number,
  refCols: string[],
  onDelete: string,
  onUpdate: string,
  def: string,
];
type IndexRow = [oid: number, name: string, definition: string, unique: boolean, primary: boolean];

// Вызывать внутри sandbox.preview: так интроспекция видит только закоммиченное и не пересекается с другими запросами
export async function introspect(db: DbClient, opts: { sampleRows?: number } = {}): Promise<SchemaSnapshot> {
  const limit = opts.sampleRows ?? 15;
  const rows = async <T>(sql: string) => (await db.query(sql)).rows as T[];

  const schemas = (
    await rows<[string]>(
      `select n.nspname from pg_namespace n where ${NS} and n.nspname not like 'pg_temp_%' order by 1`,
    )
  ).map((r) => r[0]);
  const tableRows = await rows<TableRow>(`
    select c.oid::int, n.nspname, c.relname, c.relkind::text, c.relpersistence::text, c.relispopulated, obj_description(c.oid, 'pg_class')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'v', 'm', 'p') and ${NS} order by n.nspname, c.relname`);
  const columns = await rows<ColumnRow>(`
    select a.attrelid::int, a.attname, format_type(a.atttypid, a.atttypmod), not a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid), a.attidentity::text, a.attgenerated::text
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v', 'm', 'p') and ${NS}
    order by a.attrelid, a.attnum`);
  const constraints = await rows<ConstraintRow>(`
    select con.conrelid::int, con.conname, con.contype::text,
      array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.ord),
      con.confrelid::int,
      array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum order by k.ord),
      con.confdeltype::text, con.confupdtype::text, pg_get_constraintdef(con.oid)
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
    where con.contype in ('p', 'u', 'f', 'c') and ${NS} order by con.conrelid, con.conname`);
  const indexes = await rows<IndexRow>(`
    select i.indrelid::int, ic.relname, pg_get_indexdef(i.indexrelid), i.indisunique, i.indisprimary
    from pg_index i join pg_class ic on ic.oid = i.indexrelid
    join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    where ${NS} order by i.indrelid, ic.relname`);
  const sequences = await rows<[string, string, number | null]>(
    'select schemaname::text, sequencename::text, last_value from pg_sequences order by 1, 2',
  );

  const byOid = new Map(
    tableRows.map(([oid, schema, name]) => [oid, { schema: schemaName(schema), table: name }]),
  );
  const idOf = (oid: number) => {
    const t = byOid.get(oid);
    return t ? `${t.schema}.${t.table}` : null;
  };
  const tables: TableInfo[] = [];
  for (const [oid, schema, name, relkind, persistence, populated, comment] of tableRows) {
    const own = constraints.filter((c) => c[0] === oid);
    const has = (type: string, col: string, alone = false) =>
      own.some(([, , t, cols]) => t === type && cols.includes(col) && (!alone || cols.length === 1));
    const kind = persistence === 't' ? 'temp' : KINDS[relkind];
    const from = `${ident(schema)}.${ident(name)}`;
    let sampleRows: unknown[][] = [];
    let sampleCtids: string[] = [];
    let sampleXmins: string[] | undefined;
    let rowCount = 0;
    if (populated) {
      rowCount = (await rows<[number]>(`select count(*)::int from ${from}`))[0][0];
      if (relkind === 'r' || relkind === 'p') {
        // алиас обязателен: без него order by ctid сортирует текстовый ctid, и (0,10) встаёт перед (0,2)
        const res = await rows<unknown[]>(
          `select t.ctid::text as __ctid, t.xmin::text as __xmin, t.* from ${from} t order by t.ctid limit ${limit}`,
        );
        sampleCtids = res.map((r) => r[0] as string);
        sampleXmins = res.map((r) => r[1] as string);
        sampleRows = res.map((r) => r.slice(2));
      } else {
        sampleRows = await rows<unknown[]>(`select * from ${from} limit ${limit}`);
        sampleCtids = sampleRows.map((_, i) => `row:${i}`);
      }
    }
    tables.push({
      id: idOf(oid) as string,
      schema: schemaName(schema),
      name,
      kind,
      columns: columns
        .filter((c) => c[0] === oid)
        .map(([, col, type, nullable, def, identity, generated]) => {
          const fk = own.find(([, , t, cols]) => t === 'f' && cols.includes(col));
          const target = fk && byOid.get(fk[4]);
          return {
            name: col,
            type,
            nullable,
            default: def,
            isPk: has('p', col),
            isUnique: has('u', col, true),
            isGenerated: generated !== '',
            identity: identity === 'a' ? 'always' : identity === 'd' ? 'by default' : null,
            checks: own.filter(([, , t, cols]) => t === 'c' && cols.includes(col)).map((c) => c[8]),
            fk: fk && target ? { ...target, column: fk[5][fk[3].indexOf(col)] } : null,
          };
        }),
      rowCount,
      sampleRows,
      sampleCtids,
      sampleXmins,
      indexes: indexes
        .filter((i) => i[0] === oid)
        .map(([, n, definition, unique, primary]) => ({ name: n, definition, unique, primary })),
      comment,
    });
  }

  const fks: FkInfo[] = constraints
    .filter((c) => c[2] === 'f' && byOid.has(c[0]) && byOid.has(c[4]))
    .map(([oid, name, , cols, refOid, refCols, onDelete, onUpdate]) => ({
      name,
      from: { tableId: idOf(oid) as string, columns: cols },
      to: { tableId: idOf(refOid) as string, columns: refCols },
      onDelete: FK_ACTIONS[onDelete],
      onUpdate: FK_ACTIONS[onUpdate],
    }));

  return {
    schemas,
    tables,
    fks,
    sequences: sequences.map(([schema, name, lastValue]) => ({
      schema: schemaName(schema),
      name,
      lastValue,
    })),
  };
}
