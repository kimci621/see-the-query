// Спайк: libpg-query в браузере под Vite и перевод байтовых позиций в символьные
import { report } from './main';

export async function run() {
  const t = performance.now();
  const { loadModule, parseSync } = await import('libpg-query');
  await loadModule();
  const loadMs = Math.round(performance.now() - t);
  const sql = "select 'Привет' as x, b.title from book b";
  const t2 = performance.now();
  for (let i = 0; i < 100; i++) parseSync(sql);
  const parseMs = (performance.now() - t2) / 100;
  const ast = parseSync(sql) as any;
  const byteLoc = ast.stmts[0].stmt.SelectStmt.targetList[1].ResTarget.val.ColumnRef.location as number;
  const bytes = new TextEncoder().encode(sql);
  const charLoc = new TextDecoder().decode(bytes.slice(0, byteLoc)).length;
  const { deparseSync } = await import('pgsql-deparser');
  report({ loadMs, parseMs: Number(parseMs.toFixed(3)), byteLoc, charLoc, charAtLoc: sql.slice(charLoc, charLoc + 7), deparsed: deparseSync(ast.stmts[0].stmt), done: true });
}
