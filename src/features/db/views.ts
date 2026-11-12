import type { TableInfo } from './introspect';
import { type DbClient, DbException, SANDBOX_CRASHED, SANDBOX_TIMEOUT } from './types';

const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;
const dead = (error: unknown) =>
  error instanceof DbException && (error.db.code === SANDBOX_TIMEOUT || error.db.code === SANDBOX_CRASHED);

export async function viewDefinition(db: DbClient, viewId: string): Promise<string | null> {
  const result = await db.query(
    `select pg_get_viewdef(c.oid, true)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('v', 'm')
       and (case when n.nspname like 'pg_temp_%' then 'pg_temp' else n.nspname end) || '.' || c.relname = $1`,
    [viewId],
  );
  return (result.rows[0]?.[0] as string | undefined) ?? null;
}

// Сравнение внутри отдельной точки сохранения: ошибка типа не портит транзакцию вызывающего.
export async function matviewLag(db: DbClient, mv: TableInfo): Promise<number | null> {
  if (mv.kind !== 'matview') return null;
  let ownTransaction = false;
  try {
    await db.query('savepoint __vs_matview_lag');
  } catch (error) {
    if (!(error instanceof DbException) || error.db.code !== '25P01') throw error;
    await db.query('begin');
    ownTransaction = true;
    await db.query('savepoint __vs_matview_lag');
  }
  let crashed = false;
  try {
    await db.query('set local transaction_read_only = on');
    const definition = await viewDefinition(db, mv.id);
    if (!definition) return null;
    const source = definition.replace(/;\s*$/, '');
    const view = `${ident(mv.schema)}.${ident(mv.name)}`;
    const result = await db.query(`
      with __vs_current as materialized (${source})
      select count(*)::int from (
        (select * from ${view} except all select * from __vs_current)
        union all
        (select * from __vs_current except all select * from ${view})
      ) as differences`);
    return Number(result.rows[0][0]);
  } catch (error) {
    if (dead(error)) {
      crashed = true;
      throw error;
    }
    if (!(error instanceof DbException)) throw error;
    return null;
  } finally {
    if (!crashed) {
      await db.query('rollback to savepoint __vs_matview_lag');
      await db.query('release savepoint __vs_matview_lag');
      if (ownTransaction) await db.query('rollback');
    }
  }
}
