// Подписи стадий на русском: «<КЛАУЗ>: <что произошло>»

export function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

export const rowsWord = (n: number) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;
const colsWord = (n: number) => `${n} ${plural(n, 'колонка', 'колонки', 'колонок')}`;

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
    `WHERE: осталось ${after} из ${rowsWord(before)}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  project: (kept: number, from: number, computed: number) =>
    `SELECT: ${colsWord(kept)} из ${from}${computed ? `, вычислено ${computed}` : ''}`,
  group: (keys: string[], groups: number, rows: number) =>
    `GROUP BY ${keys.join(', ')}: ${rowsWord(rows)} → ${groups} ${plural(groups, 'группа', 'группы', 'групп')}`,
  aggregateNoGroup: (rows: number) => `Агрегат без GROUP BY: ${rowsWord(rows)} → 1 строка`,
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
