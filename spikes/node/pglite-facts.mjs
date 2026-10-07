// Спайк: проверяем факты PGlite, на которые опирается архитектура.
// Каждый check записывает факт; скрипт не падает на первом «нет», он фиксирует ответ.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, writeFileSync } from 'node:fs';

const dataset = readFileSync(new URL('../../content/datasets/bookstore.sql', import.meta.url), 'utf8');
const results = [];

async function check(name, fn) {
  const t = performance.now();
  try {
    const { ok, fact } = await fn();
    results.push({ name, ok, ms: Math.round(performance.now() - t), fact });
  } catch (e) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - t), fact: `исключение: ${e.code ?? ''} ${e.message}` });
  }
}

const q = (db, sql) => db.query(sql, [], { rowMode: 'array' });

const t0 = performance.now();
const pg = new PGlite({ extensions: { pg_trgm } });
await pg.exec(dataset);
const bootMs = Math.round(performance.now() - t0);

await check('P0.2 версия и холодный старт в Node', async () => {
  const v = (await q(pg, 'select version()')).rows[0][0];
  return { ok: v.startsWith('PostgreSQL 18'), fact: `${v.split(' on ')[0]}; старт + датасет ${bootMs} мс` };
});

await check('P0.3 dump/load маленькой БД', async () => {
  const t = performance.now();
  const blob = await pg.dumpDataDir('gzip');
  const dumpMs = Math.round(performance.now() - t);
  const t2 = performance.now();
  const copy = new PGlite({ loadDataDir: blob });
  const n = (await q(copy, 'select count(*) from book')).rows[0][0];
  const loadMs = Math.round(performance.now() - t2);
  await copy.close();
  return { ok: Number(n) === 11, fact: `dump ${dumpMs} мс, ${(blob.size / 1024).toFixed(0)} КБ gzip; load ${loadMs} мс; book=${n}` };
});

await check('P0.3 dump/load БД на 100k строк', async () => {
  const big = new PGlite();
  await big.exec(dataset);
  await big.exec(`insert into book (title, author_id, category_id, price, pages, published_at)
    select 'Книга ' || g, 1 + g % 5, 1 + g % 6, (100 + g % 3000)::numeric, 50 + g % 900, date '2000-01-01' + g % 9000
    from generate_series(1, 100000) g; analyze;`);
  const t = performance.now();
  const blob = await big.dumpDataDir('gzip');
  const dumpMs = Math.round(performance.now() - t);
  const t2 = performance.now();
  const copy = new PGlite({ loadDataDir: blob });
  const n = (await q(copy, 'select count(*) from book')).rows[0][0];
  const loadMs = Math.round(performance.now() - t2);
  await copy.close();
  await big.close();
  return { ok: Number(n) === 100011, fact: `dump ${dumpMs} мс, ${(blob.size / 1024 / 1024).toFixed(1)} МБ gzip; load ${loadMs} мс; book=${n}` };
});

await check('P0.4 ctid в INNER/LEFT/FULL JOIN', async () => {
  const inner = await q(pg, 'select b.ctid, a.ctid from book b join author a using (author_id)');
  const left = await q(pg, 'select b.ctid, a.ctid from book b left join author a using (author_id)');
  const full = await q(pg, 'select b.ctid, a.ctid from book b full join author a using (author_id)');
  const leftNulls = left.rows.filter((r) => r[1] === null).length;
  const fullLeftNulls = full.rows.filter((r) => r[0] === null).length;
  const fullRightNulls = full.rows.filter((r) => r[1] === null).length;
  const ok = inner.rows.length === 9 && left.rows.length === 11 && leftNulls === 2
    && full.rows.length === 12 && fullLeftNulls === 1 && fullRightNulls === 2;
  return { ok, fact: `inner ${inner.rows.length}; left ${left.rows.length} (без пары ${leftNulls}); full ${full.rows.length} (только автор ${fullLeftNulls}, только книга ${fullRightNulls})` };
});

await check('P0.4 ctid стабилен внутри транзакции', async () => {
  await pg.exec('begin');
  const a = (await q(pg, 'select ctid::text from book order by book_id')).rows.map((r) => r[0]).join(',');
  await q(pg, "update author set country = country where author_id = 1"); // другая таблица
  const b = (await q(pg, 'select ctid::text from book order by book_id')).rows.map((r) => r[0]).join(',');
  await pg.exec('rollback');
  return { ok: a === b, fact: a === b ? 'ctid book не меняется при изменениях других таблиц' : `разошлись: ${a} / ${b}` };
});

await check('P0.5 TEMP TABLE внутри BEGIN ... ROLLBACK', async () => {
  await pg.exec('begin');
  await pg.exec('create temp table __vs_1 as select * from book where price > 500');
  const rows = await q(pg, 'select ctid::text, title from __vs_1');
  await pg.exec('rollback');
  const gone = (await q(pg, "select to_regclass('pg_temp.__vs_1') is null")).rows[0][0];
  return { ok: rows.rows.length === 7 && gone === true, fact: `строк во временной ${rows.rows.length}, ctid первой ${rows.rows[0]?.[0]}; после rollback таблицы нет: ${gone}` };
});

await check('P0.6 statement_timeout', async () => {
  await pg.exec('begin');
  await pg.exec("set local statement_timeout = '500ms'");
  const t = performance.now();
  let fact;
  let ok = false;
  try {
    await q(pg, 'select pg_sleep(3)');
    fact = `НЕ сработал, pg_sleep(3) отработал за ${Math.round(performance.now() - t)} мс`;
  } catch (e) {
    ok = e.code === '57014';
    fact = `ошибка ${e.code} через ${Math.round(performance.now() - t)} мс`;
  }
  await pg.exec('rollback');
  const t2 = performance.now();
  await pg.exec('begin');
  await pg.exec("set local statement_timeout = '500ms'");
  try {
    await q(pg, 'select count(*) from generate_series(1, 50000000)');
    fact += `; тяжёлый CPU-запрос не прерван (${Math.round(performance.now() - t2)} мс)`;
  } catch (e) {
    fact += `; тяжёлый CPU-запрос прерван ${e.code} через ${Math.round(performance.now() - t2)} мс`;
  }
  await pg.exec('rollback');
  return { ok, fact };
});

await check('P0.7 xmin/xmax при UPDATE', async () => {
  await pg.exec('begin');
  const before = (await q(pg, 'select ctid::text, xmin::text, xmax::text from book where book_id = 1')).rows[0];
  await q(pg, 'update book set price = price + 1 where book_id = 1');
  const after = (await q(pg, 'select ctid::text, xmin::text, xmax::text from book where book_id = 1')).rows[0];
  const txid = (await q(pg, 'select pg_current_xact_id()::text')).rows[0][0];
  await pg.exec('rollback');
  return { ok: before[0] !== after[0] && after[1] === txid, fact: `до ${before.join(' ')}; после ${after.join(' ')}; txid ${txid}` };
});

await check('P0.8 pg_trgm', async () => {
  await pg.exec('create extension if not exists pg_trgm');
  const s = (await q(pg, "select round(similarity('Пушкин', 'Пушкинн')::numeric, 2)")).rows[0][0];
  return { ok: Number(s) > 0.5, fact: `similarity = ${s}` };
});

await check('P0.8 роли, SET ROLE, GRANT', async () => {
  await pg.exec('begin');
  await pg.exec('create role reader');
  await pg.exec('grant select on book to reader');
  await pg.exec('set role reader');
  const n = (await q(pg, 'select count(*) from book')).rows[0][0];
  await pg.exec('savepoint s');
  let denied = 'нет ошибки';
  try { await q(pg, "insert into book (title) values ('xx')"); } catch (e) { denied = e.code; }
  await pg.exec('rollback to savepoint s');
  await pg.exec('reset role');
  await pg.exec('rollback');
  return { ok: Number(n) === 11 && denied === '42501', fact: `select под reader: ${n}; insert под reader: ${denied}` };
});

await check('P0.9 поля ошибок PGlite', async () => {
  const errs = {};
  for (const [label, sql] of [
    ['42703', 'select nme from book'],
    ['23505', "insert into customer (name, email, created_at) values ('X', 'anna@example.com', now())"],
    ['23503', "insert into orders (customer_id, created_at) values (999, now())"],
    ['23502', 'insert into book (title) values (null)'],
    ['23514', "update customer set bonus = -1 where customer_id = 1"],
  ]) {
    await pg.exec('begin');
    try { await q(pg, sql); errs[label] = 'нет ошибки'; } catch (e) {
      errs[label] = { code: e.code, position: e.position, constraint: e.constraint, table: e.table, column: e.column, detail: e.detail };
    }
    await pg.exec('rollback');
  }
  const ok = errs['42703'].position === '8' && errs['23505'].constraint === 'customer_email_key'
    && errs['23503'].constraint === 'orders_customer_id_fkey' && errs['23502'].column === 'title'
    && errs['23514'].constraint === 'customer_bonus_check';
  return { ok, fact: JSON.stringify(errs) };
});

await check('Review: ошибка под SAVEPOINT не рушит транзакцию', async () => {
  await pg.exec('begin');
  await pg.exec('savepoint p');
  let code = null;
  try { await q(pg, 'select nme from book'); } catch (e) { code = e.code; }
  await pg.exec('rollback to savepoint p');
  const n = (await q(pg, 'select count(*) from book')).rows[0][0];
  await pg.exec('rollback');
  return { ok: code === '42703' && Number(n) === 11, fact: `ошибка ${code}, следующий запрос вернул ${n}` };
});

await pg.close();
writeFileSync(new URL('../results/node-facts.json', import.meta.url), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.ok ? 'OK ' : 'NO '} ${r.name} (${r.ms} мс): ${r.fact}`);
