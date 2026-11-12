import type { DbClient } from '@/features/db/types';
import { ident } from '@/features/tracer/probe';

export class SplitSourceMissingError extends Error {}

export interface SplitConfig {
  source: string;
  keyColumn: string;
  extract: string;
  target: string;
  parentColumn: string;
  valueColumn: string;
}

type SplitRow = { key: string; values: unknown[] };
type SplitTable = { title: string; columns: string[]; rows: SplitRow[] };
export interface SplitFrame {
  left: SplitTable;
  right: SplitTable | null;
  caption: string;
}

export interface SplitSceneData {
  frames: [SplitFrame, SplitFrame, SplitFrame];
  truncatedParents: boolean;
  truncatedValues: boolean;
}

const SIMPLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const TABLE_NAME = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i;

// Вызывающий читает данные внутри sandbox.preview; PostgreSQL выполняет разбиение и очистку пробелов.
export async function loadSplitScene(db: DbClient, config: SplitConfig): Promise<SplitSceneData> {
  const { source, keyColumn, extract, target, parentColumn, valueColumn } = config;
  if (
    !TABLE_NAME.test(source) ||
    ![keyColumn, extract, target, parentColumn, valueColumn].every((name) => SIMPLE_NAME.test(name)) ||
    keyColumn === extract
  ) {
    throw new Error('Укажи корректные имена таблицы и колонок.');
  }
  const table = source.split('.').map(ident).join('.');
  const key = ident(keyColumn);
  const value = ident(extract);
  // ponytail: сцена ограничена 15 исходными и 200 полученными строками; для больших данных нужна пагинация.
  const raw = await db.query(`select * from ${table} order by ${key} limit 16`);
  const columns = raw.fields.map((field) => field.name);
  const keyIndex = columns.indexOf(keyColumn);
  const extractIndex = columns.indexOf(extract);
  if (keyIndex < 0 || extractIndex < 0)
    throw new SplitSourceMissingError('В исходной таблице нет нужных колонок.');
  const input = raw.rows.slice(0, 15);
  const keys = input.map((row) => row[keyIndex]);
  if (keys.some((item) => item == null) || new Set(keys.map(String)).size !== keys.length) {
    throw new Error('Для сцены нужен уникальный ключ без NULL в каждой исходной строке.');
  }
  const parts = await db.query(`
    select s.${key}, btrim(v.item)
    from (select * from ${table} order by ${key} limit 15) s
    cross join lateral unnest(string_to_array(s.${value}, ',')) with ordinality as v(item, ord)
    order by s.${key}, v.ord limit 201
  `);
  const rows = input.map((values, index) => ({ key: String(index), values }));
  const splitRows = parts.rows.slice(0, 200).map((values, index) => ({ key: String(index), values }));
  const original: SplitTable = { title: source, columns, rows };
  const split: SplitTable = {
    title: 'Отдельные значения',
    columns: [parentColumn, valueColumn],
    rows: splitRows,
  };
  const normalized: SplitTable = {
    title: source,
    columns: columns.filter((_, index) => index !== extractIndex),
    rows: rows.map((row) => ({ ...row, values: row.values.filter((_, index) => index !== extractIndex) })),
  };
  return {
    frames: [
      { left: original, right: null, caption: 'Исходная таблица: несколько значений в одной строке' },
      { left: original, right: split, caption: 'PostgreSQL разделил список на отдельные значения' },
      {
        left: normalized,
        right: { ...split, title: target },
        caption: 'Проект двух таблиц, связанных по ключу',
      },
    ],
    truncatedParents: raw.rows.length > 15,
    truncatedValues: parts.rows.length > 200,
  };
}
