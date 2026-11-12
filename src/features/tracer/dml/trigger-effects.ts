import type { SchemaSnapshot } from '@/features/db/introspect';
import { type Prober, TraceFallback } from '../probe';
import type { Relation } from '../types';
import { cascadeTargets } from './cascade';
import { snapshot, type Target, targetOf } from './shared';

interface CapturedTable {
  target: Target;
  before: Relation;
}

export interface TriggerCapture {
  candidates: string[];
  schemaShape: string;
  tables: CapturedTable[];
}

export interface TriggerEffect {
  tableId: string;
  candidates: string[];
  added: Relation;
}

async function schemaShape(prober: Prober): Promise<string> {
  const result = await prober.run(`
    select c.oid::text, n.nspname, c.relname, c.relkind::text,
      coalesce(string_agg(a.attnum::text || ':' || a.attname || ':' || a.atttypid::text || ':' || a.attisdropped::text,
        ',' order by a.attnum), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
    where c.relkind in ('r', 'p', 'v', 'm', 'i', 'I', 'S', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
    group by c.oid, n.nspname, c.relname, c.relkind order by c.oid
  `);
  return JSON.stringify(result.rows);
}

// PostgreSQL не хранит полных зависимостей PL/pgSQL: имена триггеров здесь только кандидаты.
export async function captureTriggerEffects(
  target: Target,
  schema: SchemaSnapshot,
  prober: Prober,
  op: 'insert' | 'update' | 'delete' | 'merge',
): Promise<TriggerCapture | null> {
  const events: Array<'update' | 'delete'> =
    op === 'merge' ? ['update', 'delete'] : op === 'delete' ? ['delete'] : ['update'];
  const cascades = events.flatMap((event) =>
    cascadeTargets(target.table.id, schema, event).map((fk) => fk.from.tableId),
  );
  const possibleSources = new Set([target.table.id, ...cascades]);
  const sourceTables = schema.tables.filter((table) => possibleSources.has(table.id));
  const oids = sourceTables.map((table) => `'${targetOf(table).sql.replaceAll("'", "''")}'::regclass`);
  if (!oids.length) return null;
  const triggers = await prober.run(`
    select tgname from pg_trigger
    where not tgisinternal and tgenabled <> 'D' and tgrelid = any(array[${oids.join(', ')}])
    order by tgname
  `);
  const candidates = [...new Set(triggers.rows.map(([name]) => String(name)))];
  if (!candidates.length) return null;
  const tables = schema.tables.filter(
    (table) => table.id !== target.table.id && (table.kind === 'table' || table.kind === 'temp'),
  );
  // ponytail: пробуем не более 30 таблиц; для больших схем нужен механизм наблюдения изменений сервера.
  if (tables.length > 30)
    throw new TraceFallback('Пока не анимируется: слишком много таблиц для проверки триггеров');
  const captured: CapturedTable[] = [];
  for (const table of tables) {
    const other = targetOf(table);
    captured.push({ target: other, before: await snapshot(prober, other) });
  }
  return { candidates, schemaShape: await schemaShape(prober), tables: captured };
}

// Сравнение по ctid сохраняет все значения, включая время; UPDATE и DELETE требуют отдельной модели.
export async function triggerEffects(prober: Prober, captured: TriggerCapture): Promise<TriggerEffect[]> {
  const effects: TriggerEffect[] = [];
  if ((await schemaShape(prober)) !== captured.schemaShape) {
    throw new TraceFallback('Пока не анимируется: триггер изменил структуру базы');
  }
  for (const { target, before } of captured.tables) {
    const after = await snapshot(prober, target);
    const oldKeys = new Set(before.rows.map((row) => row.key));
    const newKeys = new Set(after.rows.map((row) => row.key));
    if (before.rows.some((row) => !newKeys.has(row.key))) {
      throw new TraceFallback('Пока не анимируется: побочный UPDATE или DELETE');
    }
    const added = after.rows.filter((row) => !oldKeys.has(row.key));
    if (added.length) {
      effects.push({
        tableId: target.table.id,
        candidates: captured.candidates,
        added: { columns: after.columns, rows: added },
      });
    }
  }
  return effects;
}
