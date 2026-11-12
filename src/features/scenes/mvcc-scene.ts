import { type RawVersion, readHeapPage, type XidFacts } from '@/features/db/pageinspect';
import type { DbClient } from '@/features/db/types';

export interface MvccStep {
  caption: string;
  versions: RawVersion[];
  facts: XidFacts;
  visible: Array<{ id: string; val: string }>;
}

export async function runMvccScene(db: DbClient): Promise<MvccStep[]> {
  const schema = `vs_mvcc_${crypto.randomUUID().replaceAll('-', '')}`;
  const main = `"${schema}"."items"`;
  const parent = `"${schema}"."parent"`;
  const child = `"${schema}"."child"`;
  const facts: XidFacts = { committed: [], aborted: [], lockers: [] };
  const steps: MvccStep[] = [];
  let created = false;
  let inTransaction = false;

  const transaction = async (sql: string, commit: boolean, lock = false) => {
    await db.query('begin');
    inTransaction = true;
    // ponytail: xid8 приводится к 32-битному xid страницы; для долгоживущей базы нужна учётная эпоха.
    const xid = Number((await db.query('select pg_current_xact_id()::text')).rows[0][0]) % 2 ** 32;
    await db.query(sql);
    await db.query(commit ? 'commit' : 'rollback');
    inTransaction = false;
    (commit ? facts.committed : facts.aborted).push(xid);
    if (lock) facts.lockers.push(xid);
  };
  const capture = async (table: string, caption: string, valueColumn: string) => {
    const versions = await readHeapPage(db, table, 0);
    const rows = await db.query(`select id::text, ${valueColumn}::text from ${table} order by id`);
    steps.push({
      caption,
      versions,
      facts: { committed: [...facts.committed], aborted: [...facts.aborted], lockers: [...facts.lockers] },
      visible: rows.rows.map(([id, val]) => ({ id: String(id), val: String(val) })),
    });
  };

  try {
    await db.query(`create schema "${schema}"`);
    created = true;
    await db.query(`create table ${main} (id int primary key, val text)`);
    await transaction(`insert into ${main} values (1, 'a'), (2, 'b'), (3, 'c')`, true);
    await capture(main, 'Три вставленные строки', 'val');
    await transaction(`update ${main} set val = 'a2' where id = 1`, true);
    await capture(main, 'UPDATE создал новую версию строки 1', 'val');
    await transaction(`delete from ${main} where id = 2`, true);
    await capture(main, 'DELETE скрыл строку 2', 'val');
    await transaction(`update ${main} set val = 'zz' where id = 3`, false);
    await capture(main, 'ROLLBACK отменил изменение строки 3', 'val');
    await db.query(`create table ${parent} (id int primary key, val text)`);
    await db.query(`create table ${child} (pid int references ${parent})`);
    await transaction(`insert into ${parent} values (1, 'x')`, true);
    await transaction(`insert into ${child} values (1)`, true, true);
    await capture(parent, 'Проверка внешнего ключа оставила отметку блокировки', 'val');
    await db.query(`vacuum ${main}`);
    await capture(main, 'VACUUM освободил ненужные версии', 'val');
    return steps;
  } finally {
    if (inTransaction) await db.query('rollback');
    if (created) await db.query(`drop schema "${schema}" cascade`);
  }
}
