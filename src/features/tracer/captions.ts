// Подписи стадий на русском: «<КЛАУЗ>: <что произошло>»

import type { Locale } from '@/lib/i18n';
import { plural, rowsWord } from '@/lib/plural';

const colsWord = (n: number) => `${n} ${plural(n, 'колонка', 'колонки', 'колонок')}`;
// После «из» родительный падеж: «из 1 строки», «из 3 строк»
const ofRows = (n: number) => `${n} ${plural(n, 'строки', 'строк', 'строк')}`;

// Ключи для подписи: deparser берёт ключевые слова в кавычки ("position"), человеку они не нужны.
// Имя с заглавными, пробелом или "" ("Big Name") кавычки сохраняет. Литерал '…' берётся целиком и не меняется:
// deparser удваивает кавычки внутри ('it''s', E'a\\b''c'), \' не пишет
export const keyList = (keys: string[]) =>
  keys
    .map((k) =>
      k.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, (t) =>
        /^"[a-z_][a-z0-9_$]*"$/.test(t) ? t.slice(1, -1) : t,
      ),
    )
    .join(', ');

export const captions = {
  scan: (table: string, alias: string, n: number) =>
    `FROM ${table}${alias !== table ? ` AS ${alias}` : ''}: ${rowsWord(n)}`,
  join: (label: string, pairs: number, noLeft: number, noRight: number) => {
    const parts = [`${label}: ${pairs} ${plural(pairs, 'пара', 'пары', 'пар')}`];
    if (noLeft) parts.push(`${rowsWord(noLeft)} слева без пары`);
    if (noRight) parts.push(`${rowsWord(noRight)} справа без пары`);
    return parts.join(', ');
  },
  cross: (left: number, right: number) => `CROSS JOIN: ${left} × ${right} = ${rowsWord(left * right)}`,
  joinCompressed: (type: string, n: number) => `${type} JOIN: ${rowsWord(n)}`,
  filter: (before: number, after: number, unknown: number) =>
    `WHERE: осталось ${after} из ${ofRows(before)}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  project: (kept: number, from: number, computed: number) =>
    `SELECT: ${colsWord(kept)} из ${from}${computed ? `, вычислено ${computed}` : ''}`,
  group: (keys: string[], groups: number, rows: number) =>
    `GROUP BY ${keyList(keys)}: ${rowsWord(rows)} → ${groups} ${plural(groups, 'группа', 'группы', 'групп')}`,
  groupBy: (clause: string, groups: number, rows: number) =>
    `GROUP BY ${clause}: ${rowsWord(rows)} → ${groups} ${plural(groups, 'группа', 'группы', 'групп')}`,
  having: (before: number, after: number, unknown: number) =>
    `HAVING: осталось ${after} из ${before} ${plural(before, 'группы', 'групп', 'групп')}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  aggregateNoGroup: (rows: number) => `Агрегат без GROUP BY: ${rowsWord(rows)} → 1 строка`,
  window: (functions: string[], rows: number) =>
    `ОКНО ${functions.join(', ')}: ${rowsWord(rows)}, строки не схлопываются`,
  subqueryScalar: (value: unknown) =>
    `Подзапрос: одно значение ${value === null || value === undefined ? 'NULL' : String(value)}`,
  subqueryIn: (yes: number, unknown: number) =>
    `IN: совпало ${yes}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  subqueryExists: (yes: number) => `EXISTS: совпало ${yes}`,
  subqueryAnyAll: (label: string, yes: number, unknown: number) =>
    `${label}: прошло ${yes}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  subqueryLateral: (samples: number, outer: number, rows: number) =>
    `LATERAL: ${samples} из ${ofRows(outer)} подробно, всего ${rowsWord(rows)}`,
  projectNoFrom: (n: number) => `SELECT без FROM: ${rowsWord(n)}`,
  distinct: (before: number, after: number) =>
    `DISTINCT: ${rowsWord(before)} → ${after} ${plural(after, 'уникальная', 'уникальные', 'уникальных')}`,
  distinctOn: (on: string[], before: number, after: number) =>
    `DISTINCT ON (${keyList(on)}): ${rowsWord(before)} → ${after}, по одной на группу`,
  sort: (keys: string[], n: number) => `ORDER BY ${keyList(keys)}: ${rowsWord(n)} по порядку`,
  limit: (label: string, before: number, after: number) => `${label}: осталось ${after} из ${ofRows(before)}`,
  dmlInsert: (n: number, before: number) => `INSERT: +${rowsWord(n)}, ${before} → ${before + n}`,
  dmlUpdate: (n: number, before: number) =>
    `UPDATE: изменено ${n} из ${before} ${plural(before, 'строки', 'строк', 'строк')}`,
  dmlWhere: (op: 'update' | 'delete', n: number, before: number) =>
    `WHERE: под ${op === 'update' ? 'UPDATE попадут' : 'DELETE попадут'} ${n} из ${before} ${plural(before, 'строки', 'строк', 'строк')}`,
  dmlDelete: (n: number, before: number) => `DELETE: −${rowsWord(n)}, ${before} → ${before - n}`,
  dmlUpsert: (inserted: number, conflicts: number) =>
    `INSERT ... ON CONFLICT: +${rowsWord(inserted)}, конфликтов ${conflicts}`,
  dmlMerge: (inserted: number, updated: number, deleted: number) =>
    `MERGE: +${rowsWord(inserted)}, изменено ${updated}, удалено ${deleted}`,
  dmlTruncate: (table: string, before: number) =>
    `TRUNCATE ${table}: таблица пуста, было ${rowsWord(before)}`,
  ddl: () => 'DDL: схема обновлена',
  expand: (fn: string, before: number, after: number) => `${fn}: ${rowsWord(before)} → ${rowsWord(after)}`,
  materialize: (name: string, n: number) => `${name}: ${rowsWord(n)}`,
  error: (code: string, message: string) => `Ошибка ${code}: ${message}`,
};

const enRows = (n: number) => rowsWord(n, 'en');
const enCount = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const englishCaptions: typeof captions = {
  scan: (table, alias, n) => `FROM ${table}${alias !== table ? ` AS ${alias}` : ''}: ${enRows(n)}`,
  join: (label, pairs, noLeft, noRight) => {
    const parts = [`${label}: ${enCount(pairs, 'pair')}`];
    if (noLeft) parts.push(`${enRows(noLeft)} on the left without a match`);
    if (noRight) parts.push(`${enRows(noRight)} on the right without a match`);
    return parts.join(', ');
  },
  cross: (left, right) => `CROSS JOIN: ${left} × ${right} = ${enRows(left * right)}`,
  joinCompressed: (type, n) => `${type} JOIN: ${enRows(n)}`,
  filter: (before, after, unknown) =>
    `WHERE: ${after} of ${enRows(before)} ${after === 1 ? 'remains' : 'remain'}${unknown ? `, ${unknown} UNKNOWN` : ''}`,
  project: (kept, from, computed) =>
    `SELECT: ${enCount(kept, 'column')} of ${from}${computed ? `, ${computed} computed` : ''}`,
  group: (keys, groups, rows) => `GROUP BY ${keyList(keys)}: ${enRows(rows)} → ${enCount(groups, 'group')}`,
  groupBy: (clause, groups, rows) => `GROUP BY ${clause}: ${enRows(rows)} → ${enCount(groups, 'group')}`,
  having: (before, after, unknown) =>
    `HAVING: ${after} of ${enCount(before, 'group')} ${after === 1 ? 'remains' : 'remain'}${unknown ? `, ${unknown} UNKNOWN` : ''}`,
  aggregateNoGroup: (rows) => `Aggregate without GROUP BY: ${enRows(rows)} → 1 row`,
  window: (functions, rows) => `WINDOW ${functions.join(', ')}: ${enRows(rows)}, rows remain separate`,
  subqueryScalar: (value) =>
    `Subquery: one value ${value === null || value === undefined ? 'NULL' : String(value)}`,
  subqueryIn: (yes, unknown) => `IN: ${yes} matched${unknown ? `, ${unknown} UNKNOWN` : ''}`,
  subqueryExists: (yes) => `EXISTS: ${yes} matched`,
  subqueryAnyAll: (label, yes, unknown) => `${label}: ${yes} passed${unknown ? `, ${unknown} UNKNOWN` : ''}`,
  subqueryLateral: (samples, outer, rows) =>
    `LATERAL: ${samples} of ${enRows(outer)} shown in detail, ${enRows(rows)} total`,
  projectNoFrom: (n) => `SELECT without FROM: ${enRows(n)}`,
  distinct: (before, after) => `DISTINCT: ${enRows(before)} → ${after} unique`,
  distinctOn: (on, before, after) =>
    `DISTINCT ON (${keyList(on)}): ${enRows(before)} → ${after}, one per group`,
  sort: (keys, n) => `ORDER BY ${keyList(keys)}: ${enRows(n)} in order`,
  limit: (label, before, after) =>
    `${label}: ${after} of ${enRows(before)} ${after === 1 ? 'remains' : 'remain'}`,
  dmlInsert: (n, before) => `INSERT: +${enRows(n)}, ${before} → ${before + n}`,
  dmlUpdate: (n, before) => `UPDATE: changed ${n} of ${enRows(before)}`,
  dmlWhere: (op, n, before) => `WHERE: ${n} of ${enRows(before)} selected for ${op.toUpperCase()}`,
  dmlDelete: (n, before) => `DELETE: −${enRows(n)}, ${before} → ${before - n}`,
  dmlUpsert: (inserted, conflicts) =>
    `INSERT ... ON CONFLICT: +${enRows(inserted)}, ${enCount(conflicts, 'conflict')}`,
  dmlMerge: (inserted, updated, deleted) =>
    `MERGE: +${enRows(inserted)}, ${updated} updated, ${deleted} deleted`,
  dmlTruncate: (table, before) => `TRUNCATE ${table}: table empty, had ${enRows(before)}`,
  ddl: () => 'DDL: schema updated',
  expand: (fn, before, after) => `${fn}: ${enRows(before)} → ${enRows(after)}`,
  materialize: (name, n) => `${name}: ${enRows(n)}`,
  error: (code, message) => `Error ${code}: ${message}`,
};

export function captionsForLocale(locale: Locale = 'ru'): typeof captions {
  return locale === 'en' ? englishCaptions : captions;
}

// «LIMIT 3», «OFFSET 2, LIMIT 3», «FETCH FIRST 3 WITH TIES», «LIMIT ALL»
export function limitLabel(limit: number | null, offset: number, withTies: boolean): string {
  const parts: string[] = [];
  if (offset) parts.push(`OFFSET ${offset}`);
  if (withTies) parts.push(`FETCH FIRST ${limit} WITH TIES`);
  else if (limit !== null || !offset) parts.push(`LIMIT ${limit ?? 'ALL'}`);
  return parts.join(', ');
}
