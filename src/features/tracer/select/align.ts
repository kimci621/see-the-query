import type { RowKey } from '../types';

// Строки с равными ключами сортировки Postgres вправе вернуть в любом порядке.
// Если такая серия режется границей окна [from, to), выбираем внутрь окна те строки,
// которые реально вернул Postgres (по каноническим значениям из эталона).
// keys: строки по порядку, tupleOf: канон ключей сортировки, canonOf: канон выходных значений.
export function alignWindow(
  keys: RowKey[],
  tupleOf: (key: RowKey) => string,
  canonOf: (key: RowKey) => string,
  reference: string[],
  from: number,
  to: number,
): RowKey[] {
  const out = [...keys];
  const counts = new Map<string, number>();
  for (const c of reference) counts.set(c, (counts.get(c) ?? 0) + 1);
  const runs: Array<[number, number]> = [];
  for (let start = 0, i = 1; i <= out.length; i++) {
    if (i === out.length || tupleOf(out[i]) !== tupleOf(out[start])) {
      runs.push([start, i]);
      start = i;
    }
  }
  const take = (c: string) => {
    const n = counts.get(c) ?? 0;
    if (n > 0) counts.set(c, n - 1);
    return n > 0;
  };
  // Строки серий, целиком лежащих в окне, уже заняли свои места в эталоне
  for (const [a, b] of runs) if (a >= from && b <= to) for (let i = a; i < b; i++) take(canonOf(out[i]));
  for (const [a, b] of runs) {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (lo >= hi || (a >= from && b <= to)) continue;
    const chosen: RowKey[] = [];
    const rest: RowKey[] = [];
    for (const key of out.slice(a, b))
      (chosen.length < hi - lo && take(canonOf(key)) ? chosen : rest).push(key);
    while (chosen.length < hi - lo) chosen.push(rest.shift() as RowKey);
    out.splice(a, b - a, ...rest.slice(0, lo - a), ...chosen, ...rest.slice(lo - a));
  }
  // Внутри окна равные по ключам строки ставим в том порядке, в каком их вернул Postgres.
  // Длины серий не менялись, поэтому границы runs ещё верны; полные дубли неразличимы.
  for (const [a, b] of runs) {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (hi - lo < 2) continue;
    const slice = out.slice(lo, hi);
    const byCanon = new Map<string, RowKey[]>();
    for (const key of slice) {
      const c = canonOf(key);
      const list = byCanon.get(c);
      if (list) list.push(key);
      else byCanon.set(c, [key]);
    }
    const placed = slice.map((_, i) => byCanon.get(reference[lo + i - from])?.shift());
    const used = new Set(placed);
    const rest = slice.filter((k) => !used.has(k)).reverse();
    for (let i = lo; i < hi; i++) out[i] = placed[i - lo] ?? (rest.pop() as RowKey);
  }
  return out;
}
