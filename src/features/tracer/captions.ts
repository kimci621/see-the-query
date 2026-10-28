// Подписи стадий на русском: «<КЛАУЗ>: <что произошло>»
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
  having: (before: number, after: number, unknown: number) =>
    `HAVING: осталось ${after} из ${before} ${plural(before, 'группы', 'групп', 'групп')}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  aggregateNoGroup: (rows: number) => `Агрегат без GROUP BY: ${rowsWord(rows)} → 1 строка`,
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
  materialize: (name: string, n: number) => `${name}: ${rowsWord(n)}`,
  error: (code: string, message: string) => `Ошибка ${code}: ${message}`,
};

// «LIMIT 3», «OFFSET 2, LIMIT 3», «FETCH FIRST 3 WITH TIES», «LIMIT ALL»
export function limitLabel(limit: number | null, offset: number, withTies: boolean): string {
  const parts: string[] = [];
  if (offset) parts.push(`OFFSET ${offset}`);
  if (withTies) parts.push(`FETCH FIRST ${limit} WITH TIES`);
  else if (limit !== null || !offset) parts.push(`LIMIT ${limit ?? 'ALL'}`);
  return parts.join(', ');
}
