import type { JoinExpr, Node, RangeVar, SelectStmt } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Column, Lineage, RowKey } from '../types';
import { findTable, walk } from '../whitelist';
import { rangeOf, type SelectCtx, stageId } from './context';
import type { SelectStep } from './pipeline';

export interface Source {
  alias: string; // алиас или имя таблицы, ключ lineage
  table: TableInfo;
  rv: Node;
}

export interface JoinNode {
  jointype: 'inner' | 'left' | 'right' | 'full' | 'cross';
  right: Source;
  on: Node | null;
  using: string[] | null;
  natural: boolean;
}

const JOIN_TYPES: Record<string, JoinNode['jointype']> = {
  JOIN_LEFT: 'left',
  JOIN_RIGHT: 'right',
  JOIN_FULL: 'full',
};

// Левоглубокое дерево FROM → источники и join-узлы по порядку.
// Справа от JOIN только таблица: подзапросы и скобки возьмёт Ф10
export function flattenFrom(
  sel: SelectStmt,
  schema: SchemaSnapshot,
): { ok: true; sources: Source[]; joins: JoinNode[] } | { ok: false; reason: string } {
  const sources: Source[] = [];
  const joins: JoinNode[] = [];
  const complex = 'Пока не анимируется: сложный FROM';
  const pushSource = (rv: RangeVar): string | null => {
    const table = findTable(schema, rv.schemaname, rv.relname ?? '');
    if (!table) return 'Таблица не найдена в схеме';
    // У представления нет ctid, у секций родителя ctid повторяются
    if (table.kind === 'view') return 'Пока не анимируется: представление';
    if (table.kind === 'partitioned') return 'Пока не анимируется: секционированная таблица';
    const alias = rv.alias?.aliasname ?? rv.relname ?? '';
    // Один алиас дважды Postgres не пропустит, но lineage без него сломался бы молча
    if (sources.some((s) => s.alias === alias)) return complex;
    sources.push({ alias, table, rv: { RangeVar: rv } });
    return null;
  };
  const pushJoin = (je: JoinExpr): string | null => {
    const rv = je.rarg && 'RangeVar' in je.rarg ? je.rarg.RangeVar : null;
    if (!rv || je.alias || je.join_using_alias) return complex;
    const err = pushSource(rv);
    if (err) return err;
    const right = sources[sources.length - 1];
    let using = (je.usingClause ?? []).flatMap((n) => ('String' in n ? [n.String.sval ?? ''] : []));
    if (je.isNatural) {
      // NATURAL = USING по общим именам колонок, в порядке левой стороны
      const rightNames = new Set(right.table.columns.map((c) => c.name));
      const leftNames = sources.slice(0, -1).flatMap((s) => s.table.columns.map((c) => c.name));
      using = [...new Set(leftNames)].filter((n) => rightNames.has(n));
    }
    // NATURAL без общих колонок Postgres выполняет как CROSS JOIN
    const cross = !je.quals && !using.length && je.jointype === 'JOIN_INNER';
    joins.push({
      jointype: cross ? 'cross' : (JOIN_TYPES[je.jointype ?? ''] ?? 'inner'),
      right,
      on: je.quals ?? null,
      using: using.length ? using : null,
      natural: Boolean(je.isNatural) && !cross,
    });
    return null;
  };
  const walkFrom = (n: Node): string | null => {
    if ('RangeVar' in n) return pushSource(n.RangeVar);
    if ('JoinExpr' in n && n.JoinExpr.larg) return walkFrom(n.JoinExpr.larg) ?? pushJoin(n.JoinExpr);
    return complex;
  };
  for (const [i, item] of (sel.fromClause ?? []).entries()) {
    // Запятая в FROM - это CROSS JOIN со следующей таблицей. JOIN после запятой меняет видимость алиасов
    if (i > 0) {
      if (!('RangeVar' in item)) return { ok: false, reason: complex };
      const err = pushSource(item.RangeVar);
      if (err) return { ok: false, reason: err };
      joins.push({
        jointype: 'cross',
        right: sources[sources.length - 1],
        on: null,
        using: null,
        natural: false,
      });
      continue;
    }
    const err = walkFrom(item);
    if (err) return { ok: false, reason: err };
  }
  return { ok: true, sources, joins };
}

// Текст одного JOIN-узла для FROM до k-го включительно
export function joinFragment(j: JoinNode): string {
  const rel = sqlOf(j.right.rv);
  if (j.jointype === 'cross') return ` CROSS JOIN ${rel}`;
  const kw = { inner: 'JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL JOIN' }[j.jointype];
  if (j.natural) return ` NATURAL ${kw} ${rel}`;
  if (j.using) return ` ${kw} ${rel} USING (${j.using.map(ident).join(', ')})`;
  return ` ${kw} ${rel} ON ${j.on ? sqlOf(j.on) : 'TRUE'}`;
}

// Колонки после k-го JOIN: правые USING-колонки выброшены, слитая колонка остаётся на месте левой.
// Значение слитой = coalesce сторон: у строки без пары слева (RIGHT, FULL) оно берётся справа
export function joinLayout(
  ctx: Pick<SelectCtx, 'sourceColumns' | 'joins'>,
  k: number,
): { columns: Column[]; values: (raw: unknown[]) => unknown[] } {
  const starts: number[] = [];
  const raw = ctx.sourceColumns.slice(0, k + 2).flatMap((cols, i) => {
    starts[i] = i ? starts[i - 1] + ctx.sourceColumns[i - 1].length : 0;
    return cols;
  });
  const keep = raw.map(() => true);
  const merges: Array<[number, number]> = [];
  for (const [m, j] of ctx.joins.slice(0, k + 1).entries()) {
    for (const name of j.using ?? []) {
      const r = starts[m + 1] + ctx.sourceColumns[m + 1].findIndex((c) => c.name === name);
      const l = raw.findIndex((c, i) => keep[i] && i < starts[m + 1] && c.name === name);
      keep[r] = false;
      if (l >= 0) merges.push([l, r]);
    }
  }
  const kept = raw.flatMap((_, i) => (keep[i] ? [i] : []));
  return {
    columns: kept.map((i) => raw[i]),
    values: (row) => {
      const v = [...row];
      for (const [l, r] of merges) v[l] ??= v[r];
      return kept.map((i) => v[i]);
    },
  };
}

// Квалифицированные 'alias.column' из ON-условия в порядке вхождения
function onColumnNames(j: JoinNode): string[] {
  const out: string[] = [];
  walk(j.on, (key, value) => {
    if (key !== 'ColumnRef') return;
    const parts = ((value as { fields?: Node[] }).fields ?? []).flatMap((f) =>
      'String' in f ? [f.String.sval ?? ''] : [],
    );
    if (parts.length) out.push(parts.join('.'));
  });
  return out;
}

// «INNER JOIN USING (author_id)», «NATURAL LEFT JOIN»
function joinLabel(j: JoinNode): string {
  const type = `${j.jointype.toUpperCase()} JOIN`;
  if (j.natural) return `NATURAL ${type}`;
  return j.using ? `${type} USING (${j.using.join(', ')})` : type;
}

// JOIN: стадия на каждый узел. Проба с FROM до k-го JOIN включительно, пары читаются из lineage:
// у строки без пары ctid несопоставленной стороны NULL
export const joinStep: SelectStep = {
  name: 'join',
  applies: (ctx) => ctx.joins.length > 0,
  async run(ctx) {
    // Строк в каждом источнике: для подписи CROSS JOIN «N × M»
    const scanned = ctx.stages.flatMap((s) => (s.kind === 'scan' ? [s.output.rows.length] : []));
    let leftCount = scanned[0];
    for (const [k, j] of ctx.joins.entries()) {
      const aliases = ctx.aliasOrder.slice(0, k + 2);
      const leftAliases = aliases.slice(0, -1);
      const lineageSql = aliases.map((a) => `${ident(a)}.ctid::text`).join(', ');
      const colsSql = aliases.map((a) => `${ident(a)}.*`).join(', ');
      const orderSql = aliases.map((a) => `${ident(a)}.ctid`).join(', ');
      const r = await ctx.prober.rows(
        `SELECT ${lineageSql}, ${colsSql}${ctx.sql.fromUpTo(k)} ORDER BY ${orderSql}`,
      );
      // Колонки пробы идут источниками подряд, как в их scan-стадиях
      const layout = joinLayout(ctx, k);
      const pairs: Array<[RowKey | null, RowKey | null]> = [];
      ctx.rows = r.rows.map((row) => {
        const lineage: Lineage = {};
        aliases.forEach((a, i) => {
          lineage[a] = (row[i] as string | null) ?? null;
        });
        const leftKey = leftAliases.every((a) => lineage[a] === null) ? null : rowKeyOf(lineage, leftAliases);
        const rightKey = lineage[j.right.alias] === null ? null : rowKeyOf(lineage, [j.right.alias]);
        pairs.push([leftKey, rightKey]);
        return { key: rowKeyOf(lineage, aliases), lineage, values: layout.values(row.slice(aliases.length)) };
      });
      ctx.columns = layout.columns;
      // [left, null]: левой строке не нашлась пара; [null, right]: правой
      const lonelyLeft = pairs.filter(([, rr]) => rr === null).length;
      const lonelyRight = pairs.filter(([l]) => l === null).length;
      ctx.stages.push({
        id: stageId(ctx, 'join'),
        kind: 'join',
        joinType: j.jointype,
        leftAliases,
        rightAlias: j.right.alias,
        pairs,
        onColumns: onColumnNames(j),
        usingColumns: j.using ?? [],
        sourceRange: rangeOf(ctx.stmt, 'from'),
        caption:
          j.jointype === 'cross'
            ? captions.cross(leftCount, scanned[k + 1])
            : captions.join(joinLabel(j), pairs.length - lonelyLeft - lonelyRight, lonelyLeft, lonelyRight),
        output: { columns: ctx.columns, rows: ctx.rows },
      });
      leftCount = ctx.rows.length;
    }
  },
};
