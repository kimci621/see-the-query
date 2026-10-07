// Спайк: parse → deparse → parse должен давать то же дерево (без позиций)
import { loadModule, parseSync } from 'libpg-query';
import { deparseSync } from 'pgsql-deparser';
import { writeFileSync } from 'node:fs';
import { QUERIES } from './queries.mjs';

await loadModule();

// Убираем поля позиций: после deparse они законно другие (в PG18 есть ещё rexpr_list_start/end у IN)
const POS = new Set(['location', 'stmt_location', 'stmt_len', 'rexpr_list_start', 'rexpr_list_end']);
function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (POS.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}

const failures = [];
let equal = 0;
for (const sql of QUERIES) {
  try {
    const a = parseSync(sql);
    const text = deparseSync(a.stmts[0].stmt);
    const b = parseSync(text);
    if (JSON.stringify(strip(a.stmts[0].stmt)) === JSON.stringify(strip(b.stmts[0].stmt))) equal++;
    else failures.push({ sql, error: 'дерево отличается', deparsed: text });
  } catch (e) {
    failures.push({ sql, error: e.message });
  }
}
const result = { total: QUERIES.length, equal, failures };
writeFileSync(new URL('../results/roundtrip.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(`roundtrip: ${equal}/${QUERIES.length}`);
for (const f of failures) console.log(`  FAIL: ${f.sql}\n        ${f.error}`);
