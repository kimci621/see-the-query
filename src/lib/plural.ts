// Склонение по числу: plural(2, 'строка', 'строки', 'строк') -> 'строки'
export function plural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

export const rowsWord = (n: number) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;
