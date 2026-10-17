// Подписи стадий на русском: «<КЛАУЗ>: <что произошло>»
import { plural, rowsWord } from '@/lib/plural';

const colsWord = (n: number) => `${n} ${plural(n, 'колонка', 'колонки', 'колонок')}`;

export const captions = {
  scan: (table: string, alias: string, n: number) =>
    `FROM ${table}${alias !== table ? ` AS ${alias}` : ''}: ${rowsWord(n)}`,
  filter: (before: number, after: number, unknown: number) =>
    `WHERE: осталось ${after} из ${rowsWord(before)}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  project: (kept: number, from: number, computed: number) =>
    `SELECT: ${colsWord(kept)} из ${from}${computed ? `, вычислено ${computed}` : ''}`,
  projectNoFrom: (n: number) => `SELECT без FROM: ${rowsWord(n)}`,
  distinct: (before: number, after: number) =>
    `DISTINCT: ${rowsWord(before)} → ${after} ${plural(after, 'уникальная', 'уникальные', 'уникальных')}`,
  distinctOn: (on: string[], before: number, after: number) =>
    `DISTINCT ON (${on.join(', ')}): ${rowsWord(before)} → ${after}, по одной на группу`,
  sort: (keys: string[], n: number) => `ORDER BY ${keys.join(', ')}: ${rowsWord(n)} по порядку`,
  limit: (label: string, before: number, after: number) =>
    `${label}: осталось ${after} из ${rowsWord(before)}`,
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
