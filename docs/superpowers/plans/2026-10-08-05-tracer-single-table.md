# Ф5 Трассировщик: одна таблица. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используй superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans, чтобы выполнять план задача за задачей. Шаги размечены чекбоксами (`- [ ]`).

**Goal:** `traceStatement` превращает SELECT по одной таблице в стадии `scan → filter → project → distinct → sort → limit` с lineage по `ctid`, подписями на русском и сверкой с прямым выполнением. Всё, что трассировщик не умеет, честно уходит в `final-only` с причиной и подсветкой `touched`.

**Architecture:** Postgres сам считает каждую стадию через пробы (спека 5.6). Пробы собираются из фрагментов AST через `pgsql-deparser` (WHERE, target list, ключи ORDER BY, выражения LIMIT), целый `SelectStmt` не депарсится никогда. Сам оператор выполняется по исходному тексту и служит эталоном. Ключевая проба P («упорядоченная проекция») одной выборкой даёт значения SELECT, порядок ORDER BY (ctid последним ключом) и значения ключей сортировки. Шаги SELECT лежат списком `SELECT_PIPELINE` в `select/pipeline.ts`: Ф7 вставит туда `join`, `group`, `having`, Ф10 окна, ядро не переписывается. Каждая проба идёт под `SAVEPOINT`, перед каждой проверяется `signal`, строковые пробы обёрнуты в `LIMIT maxRows + 1`.

**Tech Stack:** TypeScript strict, `@electric-sql/pglite@0.5.8` (PostgreSQL 18.3), `libpg-query@18.1.5`, `pgsql-deparser@18.3.10` (`deparseSync`, `QuoteUtils`), `@pgsql/types@18`, Vitest 5 (проект `node`).

**Spec:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, разделы 4 («Выборка из одной таблицы»), 5.6, 5.7, 8, 9. Контракты: `docs/superpowers/plans/2026-10-08-00-contracts.md`, разделы 4, 5, 6, 12, 13.

---

## Глобальные ограничения

- Зависимости от других фаз: Ф2 (`DbClient`, `DbException`, `introspect`, `tests/helpers/db.ts` с `withDataset` и `inPreview`), Ф4 (`initParser`, `parseSql`, `clauseRanges`, `deparse`). Ф5 начинается, когда они ✅.
- `features/tracer` не импортирует React и UI. Вход: `ParsedStatement` и `DbClient`, выход: `Trace`.
- Трассировщик вызывается внутри уже открытой транзакции превью (`sandbox.preview` или `inPreview` в тестах). Сам он `BEGIN`, `COMMIT`, `ROLLBACK` не выполняет никогда. Операторы вида `tcl` не выполняются вообще.
- На таймаут БД не полагаемся: `statement_timeout` в PGlite запросы не прерывает (контракты, раздел 1). Защита трассировщика: `signal.throwIfAborted()` перед каждой пробой, `LIMIT maxRows + 1` на каждой строковой пробе, сжатый режим при переполнении. Зависший запрос ловит сторож клиента (VS001, 3 с).
- Целый `SelectStmt` не депарсим: круговой тест показал, что `FETCH FIRST n ROWS WITH TIES` депарсится в `LIMIT n`. Депарсятся только фрагменты (`sqlOf`), WITH TIES читается из `limitOption` AST и считается в JS. Эталон выполняется по `stmt.text`.
- Сравнение AST-деревьев в Ф5 не нужно. Если понадобится (Ф7+), кроме `location` отбрасывать `rexpr_list_start` и `rexpr_list_end` у `A_Expr` (`AEXPR_IN`, PG18).
- Комментарии в коде на русском, идентификаторы на английском, подписи на русском. Длинное тире в текстах не используем.
- Перед каждым коммитом: `pnpm format`, затем `pnpm check` зелёный. Сообщение коммита по контрактам, раздел 13, последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Трекер `docs/PROGRESS.md`: перед началом пункта ⬜ → 🔄 с датой, после проверки 🔄 → ✅ с датой, в том же коммите, что последняя часть работы.

## Review Focus

1. Ничьи на границе LIMIT/OFFSET и победитель DISTINCT ON совпадают с выбором Postgres (выравнивание по эталону): `select/align.test.ts`, `select/limit.test.ts` «ничья на границе OFFSET», `select/distinct.test.ts` «DISTINCT ON без полного порядка».
2. WITH TIES не теряется, потому что целый запрос не депарсится: `select/limit.test.ts` «FETCH FIRST WITH TIES тянет равные строки».
3. Трёхзначная логика WHERE: вердикт `null` (UNKNOWN) отдельно от `false`, `= NULL` не пропускает ничего: `select/filter.test.ts`.
4. Volatile считается одной пробой на все стадии, в WHERE / DISTINCT / LIMIT уходит в `final-only`: `trace.test.ts` «volatile», `whitelist.test.ts` «volatile в SELECT и ORDER BY допустим».
5. Нет опоры на таймаут БД: `signal` между пробами, `LIMIT maxRows + 1`, сжатый режим с точными счётчиками, ошибка пробы не ломает транзакцию: `probe.test.ts`, `savepoint.test.ts`, `trace.test.ts` «сжатый режим» и «отменённый signal».

## Отклонения от контрактов

Задача 1 первым шагом вносит их в `docs/superpowers/plans/2026-10-08-00-contracts.md` отдельным коммитом `docs(contracts): ...` и добавляет пункт в трекер (правило из шапки контрактов):

1. `StageBase.rowCount?: number`: точное число строк стадии. В сжатом режиме `output.rows` пуст, оверлей рисует полосы по `rowCount`.
2. `rowkey.ts`: `resultKey(index)` → `'r:0'` для строк SELECT без FROM.
3. `select/pipeline.ts`: `interface SelectStep { name; applies(ctx); run(ctx) }` и `SELECT_PIPELINE`. Точка расширения для Ф7 и Ф10.
4. `whitelist.ts` дополнительно экспортирует `selectFeatures`, `SUPPORTED`, `findTable`, `touchedOf`, `walk`, `funcName`, `VOLATILE`, `AGGREGATES`.
5. Новые файлы: `probe.ts` (`createProber`, `ProbeOverflow`, `sqlOf`, `ident`, `typeNames`), `select/context.ts`, `select/align.ts`, `select/compressed.ts`, `tests/helpers/trace.ts` (`traceSql`, `summary`, `stageOf`, `column`), `tests/tracer/golden.queries.ts`.
6. Трекер P5.9: формулировка «позиции через row_number» меняется на «позиции из упорядоченной пробы P (ORDER BY + ctid)». Причина: P даёт порядок, значения и ключи одной пробой, `random()` в ORDER BY считается один раз.
7. Volatile (спека 5.6 говорит «значения из эталонного выполнения»): эталон нельзя связать со строками без lineage, поэтому значения стадий берутся из одной пробы P, стадии помечены `volatile`, `Trace.result` остаётся прямым выполнением, сверка для volatile только по числу строк. Нужна правка формулировки спеки 5.6 после согласования с пользователем.
8. Ошибка прямого выполнения: `mode: 'final-only'`, `fallbackReason: 'Запрос завершился ошибкой'`, одна стадия `error` с `focus = touched`.

## Карта файлов

```
src/features/tracer/
  types.ts            контракт раздела 6 + StageBase.rowCount              (задача 1)
  rowkey.ts           rowKeyOf, groupKey, resultKey                         (задача 1)
  whitelist.ts        признаки SELECT, причины final-only, touched          (задача 2)
  savepoint.ts        withSavepoint                                         (задача 3)
  probe.ts            createProber, ProbeOverflow, sqlOf, ident, typeNames  (задача 3)
  captions.ts         подписи на русском                                    (задача 4)
  verify.ts           canon, rowCanon, sameResult                           (задача 5)
  trace.ts            traceStatement                                        (задачи 6, 12, 13)
  select/align.ts     выравнивание ничьих по эталону                        (задача 5)
  select/context.ts   SelectCtx, проба P, окно LIMIT                        (задача 6)
  select/pipeline.ts  SelectStep, SELECT_PIPELINE, runSelect                (задачи 6-11)
  select/scan.ts  filter.ts  project.ts  distinct.ts  sort.ts  limit.ts      (задачи 6-11)
  select/compressed.ts  сжатый режим                                        (задача 13)
  *.test.ts, select/*.test.ts                                               (рядом с исходником)
tests/helpers/trace.ts      traceSql, summary, stageOf, column              (задача 6)
tests/tracer/golden.queries.ts, golden.test.ts                              (задача 14)
```

## Проверенные факты, на которых стоит план

Всё ниже проверено прогоном на bookstore в PGlite 0.5.8 (Node 26) 2026-10-08. Код плана целиком прогнан в отдельном проекте с заглушками Ф2/Ф4 по контрактам: 15 файлов тестов, 100 тестов зелёные, `tsc --strict --noUnusedLocals` чистый. Промежуточные состояния задач 6, 7, 10, 12 тоже прогнаны.

- Позиционный `ORDER BY 2`, имя выхода (`order by p`, неявное `order by upper`), колонка вне SELECT, `NULLS FIRST/LAST`: проба P с доп. колонками `__vs_k<i>` в конце и `ctid` последним ключом даёт порядок, совпадающий с прямым выполнением.
- Обёртка `SELECT * FROM (<проба>) AS __vs_p LIMIT n` сохраняет порядок внутренней пробы и переносит одинаковые имена колонок (`select a, a`).
- `ctid` идёт в lineage как текст `'(0,3)'`; алиас в кавычках (`"B"`, `"Книга"`) обязан идти через `QuoteUtils.quoteIdentifier`, иначе `42P01 missing FROM-clause entry`.
- Ничьи: `order by price limit 4 offset 1` и `distinct on (category_id) ... order by category_id` без выравнивания расходятся с эталоном (Postgres выбирает другую строку из равных). С выравниванием по эталону совпадают.
- `numeric` приходит строкой (`'890.00'`), `date` как `Date`, `text[]` массивом, `jsonb` объектом, `int8` из `::int8` числом. `format_type(oid, NULL)` даёт `numeric`, `text[]`, `timestamp with time zone`.
- `throwIfAborted` в синхронной функции бросает до появления промиса: `run` в `createProber` обязан быть `async`.
- `nextval` двигает последовательность и после `ROLLBACK`: превью с `nextval` меняет последовательность (риск для Ф2, трассировщик вызывает его в пробе P один раз и в эталоне один раз).

---

## Задача 1. Типы трассы и ключи строк (P5.2)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-08-00-contracts.md` (раздел 6), `docs/PROGRESS.md`
- Create: `src/features/tracer/types.ts`, `src/features/tracer/rowkey.ts`, `src/features/tracer/rowkey.test.ts`

**Interfaces:**
- `rowKeyOf(lineage: Lineage, aliasOrder: string[]): RowKey`, `groupKey(index: number): RowKey`, `resultKey(index: number): RowKey`
- Типы `Lineage`, `RowKey`, `Column`, `Row`, `Relation`, `SourceRange`, `StageBase`, `Stage`, `SchemaDiff`, `Trace`, `TraceOptions`

- [ ] **Шаг 1. Трекер и контракты.** В `docs/PROGRESS.md` P5.2 ⬜ → 🔄 с датой. В контрактах раздел 6: добавить `rowCount?: number` в `StageBase` с комментарием «точное число строк стадии; в сжатом режиме output.rows пуст», `resultKey(index)` в `rowkey.ts`, блок про `select/pipeline.ts` и новые файлы из раздела «Отклонения от контрактов» этого плана (пункты 1-5, 8). В трекер в фазу Ф5 добавить пункт `⬜ **P5.16** Правка формулировки спеки 5.6 про volatile (значения из одной пробы P) после согласования с пользователем.` и поменять текст P5.9 на «Стадия `sort` (позиции из упорядоченной пробы P: ORDER BY + ctid)». Коммит:

```bash
git add docs/superpowers/plans/2026-10-08-00-contracts.md docs/PROGRESS.md
git commit -m "docs(contracts): rowCount стадии, resultKey и пайплайн SELECT для трассировщика

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/rowkey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupKey, resultKey, rowKeyOf } from './rowkey';

describe('rowkey', () => {
  it('склеивает lineage в порядке алиасов, null → ∅', () => {
    expect(rowKeyOf({ a: '(0,1)', b: '(0,3)' }, ['b', 'a'])).toBe('b=(0,3)|a=(0,1)');
    expect(rowKeyOf({ b: '(0,3)', a: null }, ['b', 'a'])).toBe('b=(0,3)|a=∅');
  });
  it('ключи групп и строк результата', () => {
    expect(groupKey(0)).toBe('g:0');
    expect(resultKey(2)).toBe('r:2');
  });
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/rowkey.test.ts`. Ожидаемо: `Error: Cannot find module './rowkey' imported from .../src/features/tracer/rowkey.test.ts`, `Test Files 1 failed (1)`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/types.ts` (контракт раздела 6 плюс `rowCount`):

```ts
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { DbError, QueryResult } from '@/features/db/types';
import type { StatementKind } from '@/features/sql/types';

export type Lineage = Record<string, string | null>; // алиас → ctid ('(0,3)') или null
export type RowKey = string; // см. rowkey.ts
export interface Column { name: string; type: string; source?: { alias: string; column: string } }
export interface Row { key: RowKey; lineage: Lineage; values: unknown[] }
export interface Relation { columns: Column[]; rows: Row[] }
export interface SourceRange { from: number; to: number } // символьные позиции в полном тексте редактора

export interface StageBase {
  id: string;
  sourceRange?: SourceRange;
  caption: string;
  output: Relation;
  volatile?: boolean;
  compressed?: boolean;
  rowCount?: number; // точное число строк стадии; в сжатом режиме output.rows пуст
}
export type Stage = StageBase &
  (
    | { kind: 'scan'; alias: string; tableId: string }
    | {
        kind: 'join';
        joinType: 'inner' | 'left' | 'right' | 'full' | 'cross';
        leftAliases: string[];
        rightAlias: string;
        pairs: Array<[RowKey | null, RowKey | null]>;
        onColumns: string[];
        usingColumns: string[];
      }
    | { kind: 'filter'; clause: 'where' | 'having'; verdicts: Record<RowKey, true | false | null>; predicateColumns: string[] }
    | { kind: 'group'; keys: string[]; groups: Array<{ key: RowKey; members: RowKey[] }>; aggregates: string[] }
    | { kind: 'window'; partitions: Array<{ members: RowKey[] }>; computed: string[]; frame?: string }
    | { kind: 'project'; kept: string[]; removed: string[]; computed: string[]; renamed: Record<string, string> }
    | { kind: 'distinct'; on: string[] | null; stacks: Array<{ winner: RowKey; members: RowKey[] }> }
    | { kind: 'sort'; order: RowKey[]; sortKeys: string[] }
    | { kind: 'limit'; kept: RowKey[]; cut: RowKey[]; limit: number | null; offset: number }
    | {
        kind: 'setop';
        op: 'union' | 'union all' | 'intersect' | 'intersect all' | 'except' | 'except all';
        branches: [Trace, Trace];
      }
    | { kind: 'materialize'; name: string; inner: Trace }
    | { kind: 'recursion'; name: string; iterations: Relation[] }
    | { kind: 'subquery'; mode: 'scalar' | 'in' | 'exists' | 'correlated' | 'lateral'; samples: Array<{ outer: RowKey; inner: Trace }> }
    | {
        kind: 'dml';
        op: 'insert' | 'update' | 'delete' | 'merge' | 'truncate';
        tableId: string;
        inserted: RowKey[];
        deleted: RowKey[];
        updated: Array<{ key: RowKey; before: unknown[]; after: unknown[]; changedColumns: string[] }>;
        conflicts: Array<{ key: RowKey; action: 'nothing' | 'update' }>;
        mergeBranches: Record<RowKey, 'matched_update' | 'matched_delete' | 'not_matched_insert' | 'skipped'>;
        cascades: Array<{ tableId: string; deleted: RowKey[]; updated: RowKey[] }>;
      }
    | { kind: 'ddl'; diff: SchemaDiff }
    | { kind: 'error'; error: DbError; focus: { tableIds: string[]; columns: string[] } }
  );

export interface SchemaDiff {
  addedTables: string[];
  droppedTables: string[];
  addedColumns: Array<{ tableId: string; column: string }>;
  droppedColumns: Array<{ tableId: string; column: string }>;
  renamedColumns: Array<{ tableId: string; from: string; to: string }>;
  alteredColumns: Array<{ tableId: string; column: string; before: string; after: string }>;
  addedConstraints: Array<{ tableId: string; name: string; kind: 'p' | 'f' | 'u' | 'c' | 'n'; columns: string[] }>;
  droppedConstraints: Array<{ tableId: string; name: string }>;
  addedIndexes: Array<{ tableId: string; name: string }>;
  droppedIndexes: Array<{ tableId: string; name: string }>;
  addedSchemas: string[];
  droppedSchemas: string[];
  renamedTables: Array<{ from: string; to: string }>;
  before: SchemaSnapshot;
  after: SchemaSnapshot;
}

export interface Trace {
  sql: string;
  statementType: StatementKind;
  mode: 'full' | 'final-only';
  fallbackReason?: string;
  touched: { tableIds: string[]; columns: string[] };
  stages: Stage[];
  result: QueryResult | null;
  error: DbError | null;
  notices: string[];
  timingMs: number;
}

export interface TraceOptions { signal?: AbortSignal; maxRows?: number; schema: SchemaSnapshot }
```

`src/features/tracer/rowkey.ts`:

```ts
import type { Lineage, RowKey } from './types';

// Ключ строки из lineage: 'b=(0,3)|a=(0,1)', нет пары → '∅'
export function rowKeyOf(lineage: Lineage, aliasOrder: string[]): RowKey {
  return aliasOrder.map((alias) => `${alias}=${lineage[alias] ?? '∅'}`).join('|');
}

// Ключ группы GROUP BY
export function groupKey(index: number): RowKey {
  return `g:${index}`;
}

// Ключ строки результата без исходной таблицы (SELECT без FROM)
export function resultKey(index: number): RowKey {
  return `r:${index}`;
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 2 passed (2)`. Затем `pnpm typecheck` без ошибок.

- [ ] **Шаг 6. Трекер:** P5.2 🔄 → ✅ с датой.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/types.ts src/features/tracer/rowkey.ts src/features/tracer/rowkey.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): типы трассы и ключи строк

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 2. Whitelist, причины final-only и touched (P5.3)

**Files:**
- Create: `src/features/tracer/whitelist.ts`, `src/features/tracer/whitelist.test.ts`
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- `unsupportedReason(stmt: ParsedStatement): string | null`
- `selectFeatures(sel: SelectStmt): Set<Feature>`, `SUPPORTED: Set<Feature>`
- `findTable(schema, schemaName | undefined, name): TableInfo | null`
- `touchedOf(ast: Node, schema: SchemaSnapshot): { tableIds: string[]; columns: string[] }`
- `walk(node, fn)`, `funcName(fc)`, `VOLATILE`, `AGGREGATES`

Как работает: признаки считаются по AST статическими списками, поддерживаемые лежат в `SUPPORTED`. Volatile допустим только в target list и ORDER BY (там его считает одна проба P); в WHERE, DISTINCT ON, LIMIT или вместе с DISTINCT это признак `volatile-other`, он не поддерживается. `touchedOf` обходит любой оператор (SELECT, DML, DDL) и сопоставляет `RangeVar` и `ColumnRef` со снапшотом схемы.

- [ ] **Шаг 1.** Трекер: P5.3 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/whitelist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { initParser, parseSql } from '@/features/sql/parser';
import type { ParsedStatement } from '@/features/sql/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { selectFeatures, touchedOf, unsupportedReason } from './whitelist';

async function stmt(sql: string): Promise<ParsedStatement> {
  await initParser();
  const parsed = parseSql(sql);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.statements[0];
}
async function features(sql: string): Promise<string[]> {
  const s = await stmt(sql);
  if (!('SelectStmt' in s.ast)) throw new Error('не SELECT');
  return [...selectFeatures(s.ast.SelectStmt)].sort();
}

describe('whitelist', () => {
  it('распознаёт клаузы одной таблицы', async () => {
    expect(await features('select distinct on (a) a from t where b > 1 order by a limit 3')).toEqual(['distinct-on', 'limit', 'order', 'select', 'where']);
    expect(await features('select distinct a from t offset 2')).toEqual(['distinct', 'limit', 'select']);
    expect(await features('select 2 + 2')).toEqual(['no-from', 'select']);
  });
  it('volatile в SELECT и ORDER BY допустим, в WHERE и с DISTINCT нет', async () => {
    expect(unsupportedReason(await stmt('select random() from t order by random()'))).toBeNull();
    expect(unsupportedReason(await stmt('select a from t where random() < 0.5'))).toBe('Пока не анимируется: volatile-функция в WHERE, DISTINCT или LIMIT');
    expect(await features('select distinct random() from t')).toContain('volatile-other');
  });
  it('неподдерживаемое → причина на русском', async () => {
    expect(unsupportedReason(await stmt('select count(*) from book'))).toBe('Пока не анимируется: агрегатные функции');
    expect(unsupportedReason(await stmt('select b.title from book b join author a using (author_id)'))).toBe('Пока не анимируется: JOIN');
    expect(unsupportedReason(await stmt('select * from book where price > (select avg(price) from book)'))).toBe(
      'Пока не анимируется: подзапрос, агрегатные функции',
    );
    expect(unsupportedReason(await stmt('select 1 where false'))).toBe('Пока не анимируется: WHERE, ORDER BY или LIMIT без FROM');
    expect(unsupportedReason(await stmt('update book set price = 1'))).toBe('Пока не анимируется: UPDATE');
  });
  it('touched: таблицы и колонки с учётом алиасов', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const schema = await introspect(db);
        const s = await stmt('select b.title, name from book b join author a using (author_id) where price > 1');
        expect(touchedOf(s.ast, schema)).toEqual({
          tableIds: ['public.book', 'public.author'],
          columns: ['public.book.title', 'public.author.name', 'public.book.price'],
        });
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/whitelist.test.ts`. Ожидаемо: `Error: Cannot find module './whitelist'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/whitelist.ts`:

```ts
import type { FuncCall, Node, SelectStmt } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import type { ParsedStatement, StatementKind } from '@/features/sql/types';

// Функции, которые при повторном вызове дают другое значение или меняют состояние
export const VOLATILE = new Set([
  'random', 'random_normal', 'setseed', 'clock_timestamp', 'timeofday', 'nextval', 'setval', 'currval', 'lastval',
  'gen_random_uuid', 'uuidv4', 'uuidv7', 'pg_sleep', 'txid_current',
]);

// Агрегаты без GROUP BY тоже сворачивают строки, это работа Ф7
export const AGGREGATES = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'array_agg', 'string_agg', 'json_agg', 'jsonb_agg', 'json_object_agg',
  'jsonb_object_agg', 'bool_and', 'bool_or', 'every', 'bit_and', 'bit_or', 'stddev', 'stddev_pop', 'stddev_samp',
  'variance', 'var_pop', 'var_samp', 'percentile_cont', 'percentile_disc', 'mode', 'corr', 'covar_pop', 'covar_samp',
  'regr_slope', 'xmlagg', 'range_agg',
]);

export type Feature =
  | 'select' | 'no-from' | 'no-from-clauses' | 'where' | 'distinct' | 'distinct-on' | 'order' | 'limit' | 'volatile'
  | 'volatile-other' | 'join' | 'subquery' | 'function-from' | 'other-from' | 'group' | 'having' | 'aggregate'
  | 'window' | 'setop' | 'cte' | 'values' | 'into' | 'locking' | 'order-using';

// Ф7 и Ф10 расширяют этот набор вместе с шагами в select/pipeline.ts
export const SUPPORTED = new Set<Feature>(['select', 'no-from', 'where', 'distinct', 'distinct-on', 'order', 'limit', 'volatile']);

const FEATURE_LABELS: Record<Feature, string> = {
  select: 'SELECT', 'no-from': 'SELECT без FROM', 'no-from-clauses': 'WHERE, ORDER BY или LIMIT без FROM',
  where: 'WHERE', distinct: 'DISTINCT', 'distinct-on': 'DISTINCT ON', order: 'ORDER BY', limit: 'LIMIT',
  volatile: 'volatile-функции', 'volatile-other': 'volatile-функция в WHERE, DISTINCT или LIMIT',
  join: 'JOIN', subquery: 'подзапрос', 'function-from': 'функция в FROM', 'other-from': 'сложный FROM',
  group: 'GROUP BY', having: 'HAVING', aggregate: 'агрегатные функции', window: 'оконные функции',
  setop: 'UNION / INTERSECT / EXCEPT', cte: 'WITH', values: 'VALUES', into: 'SELECT INTO', locking: 'FOR UPDATE', 'order-using': 'ORDER BY ... USING',
};

const KIND_LABELS: Record<StatementKind, string> = {
  select: 'SELECT', insert: 'INSERT', update: 'UPDATE', delete: 'DELETE', merge: 'MERGE',
  ddl: 'изменение схемы', tcl: 'команды транзакций', other: 'этот оператор',
};

// Обход AST: fn видит каждое поле каждого узла
export function walk(node: unknown, fn: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, fn);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      fn(key, value);
      walk(value, fn);
    }
  }
}

export function funcName(fc: FuncCall): string {
  const last = fc.funcname?.at(-1);
  return last && 'String' in last ? (last.String.sval ?? '') : '';
}

function hasVolatile(node: unknown): boolean {
  let found = false;
  walk(node, (key, value) => {
    if (key === 'FuncCall' && VOLATILE.has(funcName(value as FuncCall))) found = true;
  });
  return found;
}

export function selectFeatures(sel: SelectStmt): Set<Feature> {
  const f = new Set<Feature>(['select']);
  if (sel.op && sel.op !== 'SETOP_NONE') f.add('setop');
  if (sel.withClause) f.add('cte');
  if (sel.intoClause) f.add('into');
  if (sel.valuesLists) f.add('values');
  if (sel.lockingClause) f.add('locking');
  if (sel.groupClause) f.add('group');
  if (sel.havingClause) f.add('having');
  if (sel.windowClause) f.add('window');
  if (!sel.fromClause) {
    f.add('no-from');
    if (sel.whereClause || sel.distinctClause || sel.sortClause || sel.limitCount || sel.limitOffset) f.add('no-from-clauses');
  } else if (sel.fromClause.length > 1) f.add('join');
  for (const item of sel.fromClause ?? []) {
    if ('JoinExpr' in item) f.add('join');
    else if ('RangeSubselect' in item) f.add('subquery');
    else if ('RangeFunction' in item) f.add('function-from');
    else if (!('RangeVar' in item)) f.add('other-from');
  }
  if (sel.whereClause) f.add('where');
  if (sel.distinctClause) f.add(Object.keys(sel.distinctClause[0]).length ? 'distinct-on' : 'distinct');
  if (sel.sortClause) f.add('order');
  if (sel.sortClause?.some((n) => 'SortBy' in n && n.SortBy.sortby_dir === 'SORTBY_USING')) f.add('order-using');
  if (sel.limitCount || sel.limitOffset) f.add('limit');
  walk([sel.targetList, sel.whereClause, sel.sortClause, sel.distinctClause, sel.limitCount, sel.limitOffset], (key, value) => {
    if (key === 'SubLink') f.add('subquery');
    if (key === 'FuncCall') {
      const fc = value as FuncCall;
      if (fc.over) f.add('window');
      else if (fc.agg_star || AGGREGATES.has(funcName(fc))) f.add('aggregate');
    }
  });
  // Volatile допустим только в SELECT и ORDER BY: там его считает одна проба
  if (hasVolatile([sel.targetList, sel.sortClause])) f.add('volatile');
  if (hasVolatile([sel.whereClause, sel.distinctClause, sel.limitCount, sel.limitOffset])) f.add('volatile-other');
  if (f.has('volatile') && (f.has('distinct') || f.has('distinct-on'))) f.add('volatile-other');
  return f;
}

// null = оператор трассируется полностью
export function unsupportedReason(stmt: ParsedStatement): string | null {
  if (stmt.kind !== 'select' || !('SelectStmt' in stmt.ast)) return `Пока не анимируется: ${KIND_LABELS[stmt.kind]}`;
  const bad = [...selectFeatures(stmt.ast.SelectStmt)].filter((f) => !SUPPORTED.has(f));
  return bad.length ? `Пока не анимируется: ${bad.map((f) => FEATURE_LABELS[f]).join(', ')}` : null;
}

// Таблица из снапшота по имени из запроса: временные раньше public, как в search_path
export function findTable(schema: SchemaSnapshot, schemaName: string | undefined, name: string): TableInfo | null {
  const matches = schema.tables.filter((t) => t.name === name && (schemaName ? t.schema === schemaName : t.kind === 'temp' || t.schema === 'public'));
  return matches.find((t) => t.kind === 'temp') ?? matches[0] ?? null;
}

// Что подсветить на доске: все упомянутые таблицы и колонки
export function touchedOf(ast: Node, schema: SchemaSnapshot): { tableIds: string[]; columns: string[] } {
  const tables = new Map<string, TableInfo>(); // алиас или имя → таблица
  const names: Array<{ qualifier: string | null; name: string }> = [];
  walk(ast, (key, value) => {
    if (key === 'RangeVar') {
      const rv = value as { schemaname?: string; relname?: string; alias?: { aliasname?: string } };
      const table = rv.relname ? findTable(schema, rv.schemaname, rv.relname) : null;
      if (table) tables.set(rv.alias?.aliasname ?? table.name, table);
    }
    if (key === 'ColumnRef') {
      const parts = ((value as { fields?: Node[] }).fields ?? []).flatMap((n) => ('String' in n ? [n.String.sval ?? ''] : []));
      if (parts.length) names.push({ qualifier: parts.length > 1 ? parts[parts.length - 2] : null, name: parts[parts.length - 1] });
    }
  });
  const columns = new Set<string>();
  for (const { qualifier, name } of names) {
    const candidates = qualifier ? [tables.get(qualifier)].filter((t) => t !== undefined) : [...tables.values()];
    for (const t of candidates) if (t.columns.some((c) => c.name === name)) columns.add(`${t.id}.${name}`);
  }
  return { tableIds: [...new Set([...tables.values()].map((t) => t.id))], columns: [...columns] };
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 4 passed (4)`.

- [ ] **Шаг 6.** Трекер: P5.3 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/whitelist.ts src/features/tracer/whitelist.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): whitelist SELECT, причины final-only и touched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 3. Сборщик проб: SAVEPOINT, LIMIT, signal, фрагменты SQL (P5.4)

**Files:**
- Create: `src/features/tracer/savepoint.ts`, `src/features/tracer/savepoint.test.ts`, `src/features/tracer/probe.ts`, `src/features/tracer/probe.test.ts`
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- `withSavepoint<T>(db: DbClient, fn: () => Promise<T>): Promise<T>`
- `createProber(db, { signal?, maxRows }): Prober` с `run(sql)` и `rows(sql)`; `class ProbeOverflow extends Error`
- `sqlOf(node: Node): string` (фрагмент AST в одну строку), `ident(name): string`, `typeNames(prober, oids, cache)`

Решение по P5.4 («deparser или склейка по позициям»): deparser для фрагментов. Склейка по позициям не нужна: депарсер правильно отдаёт WHERE, target list, `SortBy`, `RangeVar` с алиасом и выражения LIMIT. Единственная найденная потеря (WITH TIES) живёт на уровне целого `SelectStmt`, который мы не депарсим.

- [ ] **Шаг 1.** Трекер: P5.4 ⬜ → 🔄.

- [ ] **Шаг 2. Падающие тесты** `src/features/tracer/savepoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DbException } from '@/features/db/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { withSavepoint } from './savepoint';

describe('withSavepoint', () => {
  it('ошибка пробы не ломает транзакцию превью', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await expect(withSavepoint(db, () => db.query('select nme from book'))).rejects.toBeInstanceOf(DbException);
        const r = await withSavepoint(db, () => db.query('select count(*)::int from book'));
        expect(r.rows).toEqual([[11]]);
      }),
    ));
});
```

`src/features/tracer/probe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { createProber, ident, ProbeOverflow, sqlOf } from './probe';

describe('probe', () => {
  it('строковая проба больше maxRows → ProbeOverflow', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const prober = createProber(db, { maxRows: 5 });
        await expect(prober.rows('select * from book')).rejects.toBeInstanceOf(ProbeOverflow);
        expect((await prober.rows('select * from book where price > 2000')).rows).toHaveLength(2);
      }),
    ));
  it('отменённый signal останавливает следующую пробу до запроса', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const controller = new AbortController();
        const prober = createProber(db, { maxRows: 10, signal: controller.signal });
        await prober.run('select 1');
        controller.abort();
        await expect(prober.run('select 1')).rejects.toMatchObject({ name: 'AbortError' });
      }),
    ));
  it('фрагменты AST в одну строку, идентификаторы в кавычках по нужде', async () => {
    await initParser();
    const parsed = parseSql('select title from book where price > 500 and pages < 100');
    if (!parsed.ok || !('SelectStmt' in parsed.statements[0].ast)) throw new Error('parse');
    const where = parsed.statements[0].ast.SelectStmt.whereClause;
    if (!where) throw new Error('нет WHERE');
    expect(sqlOf(where)).toBe('price > 500 AND pages < 100');
    expect([ident('b'), ident('B'), ident('order')]).toEqual(['b', '"B"', '"order"']);
  });
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/savepoint.test.ts src/features/tracer/probe.test.ts`. Ожидаемо: `Cannot find module './savepoint'` и `Cannot find module './probe'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/savepoint.ts`:

```ts
import type { DbClient } from '@/features/db/types';

// Выполняет fn под SAVEPOINT: ошибка внутри не ломает открытую транзакцию превью
export async function withSavepoint<T>(db: DbClient, fn: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT __vs_sp');
  try {
    const result = await fn();
    await db.query('RELEASE SAVEPOINT __vs_sp');
    return result;
  } catch (e) {
    // Откат может упасть сам (worker уже убит сторожем), наружу идёт исходная ошибка
    await db.query('ROLLBACK TO SAVEPOINT __vs_sp').catch(() => undefined);
    await db.query('RELEASE SAVEPOINT __vs_sp').catch(() => undefined);
    throw e;
  }
}
```

`src/features/tracer/probe.ts`:

```ts
import type { Node } from '@pgsql/types';
import { QuoteUtils } from 'pgsql-deparser';
import type { DbClient, QueryResult } from '@/features/db/types';
import { deparse } from '@/features/sql/deparse';
import { withSavepoint } from './savepoint';

// Проба вернула больше maxRows строк: трасса уходит в сжатый режим
export class ProbeOverflow extends Error {
  constructor() {
    super('probe overflow');
    this.name = 'ProbeOverflow';
  }
}

export interface Prober {
  maxRows: number;
  run(sql: string): Promise<QueryResult>; // проба как есть (агрегаты, счётчики)
  rows(sql: string): Promise<QueryResult>; // проба со страховочным LIMIT maxRows + 1
}

// statement_timeout в PGlite не прерывает запросы, поэтому: signal между пробами и LIMIT на каждой строковой пробе
export function createProber(db: DbClient, opts: { signal?: AbortSignal; maxRows: number }): Prober {
  const run = async (sql: string) => {
    opts.signal?.throwIfAborted();
    return withSavepoint(db, () => db.query(sql));
  };
  return {
    maxRows: opts.maxRows,
    run,
    async rows(sql) {
      const result = await run(`SELECT * FROM (${sql}) AS __vs_p LIMIT ${opts.maxRows + 1}`);
      if (result.rows.length > opts.maxRows) throw new ProbeOverflow();
      return result;
    },
  };
}

// Фрагмент AST в одну строку SQL. Целый SelectStmt не депарсим: депарсер теряет WITH TIES
export function sqlOf(node: Node): string {
  return deparse(node).replace(/\s*\n\s*/g, ' ');
}

// Идентификатор в кавычках, если нужно: "B", "order"
export function ident(name: string): string {
  return QuoteUtils.quoteIdentifier(name);
}

// Имена типов по OID: 1184 → 'timestamp with time zone'. cache живёт одну трассу
export async function typeNames(prober: Prober, oids: number[], cache: Map<number, string>): Promise<Map<number, string>> {
  const missing = [...new Set(oids)].filter((o) => !cache.has(o));
  if (missing.length) {
    const r = await prober.run(`SELECT oid::int, format_type(oid, NULL) FROM pg_type WHERE oid IN (${missing.join(', ')})`);
    for (const [oid, name] of r.rows) cache.set(oid as number, name as string);
  }
  return cache;
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 4 passed (4)`. Если упал тест про signal с сообщением `AbortError` вне `expect`, значит `run` не `async`: синхронный `throwIfAborted` бросает до промиса.

- [ ] **Шаг 6.** Трекер: P5.4 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/savepoint.ts src/features/tracer/savepoint.test.ts src/features/tracer/probe.ts src/features/tracer/probe.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): пробы под SAVEPOINT с LIMIT и проверкой signal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 4. Подписи на русском (P5.11)

Подписи нужны всем стадиям, поэтому идут раньше стадий.

**Files:**
- Create: `src/features/tracer/captions.ts`, `src/features/tracer/captions.test.ts`
- Modify: `docs/PROGRESS.md`

**Interfaces:** `plural(n, one, few, many)`, `rowsWord(n)`, `captions.{scan, filter, project, projectNoFrom, distinct, distinctOn, sort, limit, error}`, `limitLabel(limit, offset, withTies)`

- [ ] **Шаг 1.** Трекер: P5.11 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/captions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { captions, limitLabel, plural } from './captions';

describe('captions', () => {
  it('склонение по числу', () => {
    const w = (n: number) => plural(n, 'строка', 'строки', 'строк');
    expect([1, 2, 5, 11, 12, 21, 22, 111, 0].map(w)).toEqual(['строка', 'строки', 'строк', 'строк', 'строк', 'строка', 'строки', 'строк', 'строк']);
  });
  it('подписи стадий', () => {
    expect(captions.scan('book', 'b', 11)).toBe('FROM book AS b: 11 строк');
    expect(captions.filter(11, 7, 1)).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
    expect(captions.distinct(6, 4)).toBe('DISTINCT: 6 строк → 4 уникальные');
    expect(captions.limit(limitLabel(3, 2, false), 11, 3)).toBe('OFFSET 2, LIMIT 3: осталось 3 из 11 строк');
    expect(limitLabel(1, 0, true)).toBe('FETCH FIRST 1 WITH TIES');
    expect(limitLabel(null, 0, false)).toBe('LIMIT ALL');
    expect(limitLabel(null, 9, false)).toBe('OFFSET 9');
  });
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/captions.test.ts`. Ожидаемо: `Cannot find module './captions'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/captions.ts`:

```ts
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
  scan: (table: string, alias: string, n: number) => `FROM ${table}${alias !== table ? ` AS ${alias}` : ''}: ${rowsWord(n)}`,
  filter: (before: number, after: number, unknown: number) =>
    `WHERE: осталось ${after} из ${rowsWord(before)}${unknown ? `, UNKNOWN у ${unknown}` : ''}`,
  project: (kept: number, from: number, computed: number) =>
    `SELECT: ${colsWord(kept)} из ${from}${computed ? `, вычислено ${computed}` : ''}`,
  projectNoFrom: (n: number) => `SELECT без FROM: ${rowsWord(n)}`,
  distinct: (before: number, after: number) => `DISTINCT: ${rowsWord(before)} → ${after} ${plural(after, 'уникальная', 'уникальные', 'уникальных')}`,
  distinctOn: (on: string[], before: number, after: number) => `DISTINCT ON (${on.join(', ')}): ${rowsWord(before)} → ${after}, по одной на группу`,
  sort: (keys: string[], n: number) => `ORDER BY ${keys.join(', ')}: ${rowsWord(n)} по порядку`,
  limit: (label: string, before: number, after: number) => `${label}: осталось ${after} из ${rowsWord(before)}`,
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
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 2 passed (2)`.

- [ ] **Шаг 6.** Трекер: P5.11 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/captions.ts src/features/tracer/captions.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): подписи стадий на русском

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 5. Сверка и выравнивание ничьих (P5.12, часть 1)

`sameResult` сравнивает мультимножество строк и, при ORDER BY, последовательность ключей сортировки (внутри равных ключей порядок свободен). `alignWindow` решает обратную задачу: когда серия равных по ключам строк режется окном LIMIT/OFFSET, внутрь окна попадают те строки, которые реально вернул Postgres. Подключение сверки к трассе идёт в задаче 6, пункт P5.12 закрывается там.

**Files:**
- Create: `src/features/tracer/verify.ts`, `src/features/tracer/verify.test.ts`, `src/features/tracer/select/align.ts`, `src/features/tracer/select/align.test.ts`

**Interfaces:** `canon(value)`, `rowCanon(values)`, `sameResult(stageOutput, reference, orderKeys)`, `alignWindow(keys, tupleOf, canonOf, reference, from, to): RowKey[]`

- [ ] **Шаг 1.** Трекер: P5.12 ⬜ → 🔄.

- [ ] **Шаг 2. Падающие тесты** `src/features/tracer/verify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@/features/db/types';
import type { Relation } from './types';
import { canon, sameResult } from './verify';

const rel = (rows: unknown[][]): Relation => ({ columns: [], rows: rows.map((values, i) => ({ key: `r:${i}`, lineage: {}, values })) });
const ref = (rows: unknown[][]): QueryResult => ({ fields: [], rows });

describe('verify', () => {
  it('канон различает типы и раскрывает объекты', () => {
    expect(canon(null)).toBe('null');
    expect(canon('1')).not.toBe(canon(1));
    expect(canon(new Date('2024-01-01T00:00:00Z'))).toBe('d:2024-01-01T00:00:00.000Z');
    expect(canon({ a: 1 })).toBe('j:{"a":1}');
  });
  it('мультимножество без ORDER BY: порядок не важен, дубли важны', () => {
    expect(sameResult(rel([['a'], ['b']]), ref([['b'], ['a']]), null)).toBe(true);
    expect(sameResult(rel([['a'], ['a']]), ref([['a'], ['b']]), null)).toBe(false);
    expect(sameResult(rel([['a']]), ref([['a'], ['a']]), null)).toBe(false);
  });
  it('с ORDER BY сравнивается порядок ключей, внутри равных ключей порядок свободен', () => {
    expect(sameResult(rel([['x', 1], ['y', 1], ['z', 2]]), ref([['y', 1], ['x', 1], ['z', 2]]), [1])).toBe(true);
    expect(sameResult(rel([['z', 2], ['x', 1], ['y', 1]]), ref([['x', 1], ['y', 1], ['z', 2]]), [1])).toBe(false);
  });
});
```

`src/features/tracer/select/align.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alignWindow } from './align';

// Ключ строки = 'имя', кортеж сортировки и значения заданы таблицами
const tuple: Record<string, string> = { a: '1', b: '2', c: '2', d: '2', e: '3' };
const tupleOf = (k: string) => tuple[k];
const canonOf = (k: string) => k;

describe('alignWindow', () => {
  it('серия на правой границе: внутрь окна попадает строка из эталона', () => {
    // окно [0, 2): a и одна из b/c/d; Postgres вернул d
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'd'], 0, 2)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
  it('серия на левой границе (OFFSET): строка из эталона встаёт в конец серии', () => {
    // окно [2, 5): две из b/c/d и e; Postgres вернул b, d, e
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['b', 'd', 'e'], 2, 5)).toEqual(['a', 'c', 'b', 'd', 'e']);
  });
  it('серия внутри окна и вне его не трогается', () => {
    expect(alignWindow(['a', 'b', 'c', 'd', 'e'], tupleOf, canonOf, ['a', 'b', 'c', 'd'], 0, 4)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('без ORDER BY все строки в одной серии', () => {
    expect(alignWindow(['a', 'b', 'c'], () => '', canonOf, ['c'], 0, 1)).toEqual(['c', 'a', 'b']);
  });
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/verify.test.ts src/features/tracer/select/align.test.ts`. Ожидаемо: `Cannot find module './verify'` и `Cannot find module './align'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/verify.ts`:

```ts
import type { QueryResult } from '@/features/db/types';
import type { Relation } from './types';

// Каноническая строка значения: одинаковые значения дают одинаковую строку при любом пути получения
export function canon(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (typeof value === 'object') return `j:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}

export function rowCanon(values: unknown[]): string {
  return values.map(canon).join('\u0001');
}

// Финальная стадия против прямого выполнения: мультимножество строк, при ORDER BY ещё порядок ключей
export function sameResult(stageOutput: Relation, reference: QueryResult, orderKeys: number[] | null): boolean {
  const ours = stageOutput.rows.map((r) => rowCanon(r.values));
  const theirs = reference.rows.map(rowCanon);
  if (ours.length !== theirs.length) return false;
  const a = [...ours].sort();
  const b = [...theirs].sort();
  if (a.some((x, i) => x !== b[i])) return false;
  if (!orderKeys?.length) return true;
  const keyOf = (values: unknown[]) => orderKeys.map((i) => canon(values[i])).join('\u0002');
  return stageOutput.rows.every((r, i) => keyOf(r.values) === keyOf(reference.rows[i]));
}
```

`src/features/tracer/select/align.ts`:

```ts
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
    for (const key of out.slice(a, b)) (chosen.length < hi - lo && take(canonOf(key)) ? chosen : rest).push(key);
    while (chosen.length < hi - lo) chosen.push(rest.shift() as RowKey);
    out.splice(a, b - a, ...rest.slice(0, lo - a), ...chosen, ...rest.slice(lo - a));
  }
  return out;
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 7 passed (7)`.

- [ ] **Шаг 6. Коммит** (P5.12 остаётся 🔄):

```bash
pnpm format && pnpm check
git add src/features/tracer/verify.ts src/features/tracer/verify.test.ts src/features/tracer/select/align.ts src/features/tracer/select/align.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): сверка с эталоном и выравнивание ничьих

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 6. Контекст SELECT, пайплайн, стадия scan и traceStatement (P5.5, P5.12)

Здесь появляется ядро: `SelectCtx` с ленивыми пробами (`outputs`, `ordered`, `limitParams`), пайплайн со списком шагов и `traceStatement`: эталон, ошибка → стадия `error`, `tcl` без выполнения, `final-only` по whitelist, представления и секционированные таблицы, SELECT без FROM, сверка финальной стадии. Пока в пайплайне только `scan`, поэтому тесты этой задачи используют `select *` (иначе сверка честно уводит трассу в `final-only`).

**Files:**
- Create: `src/features/tracer/select/context.ts`, `src/features/tracer/select/pipeline.ts`, `src/features/tracer/select/scan.ts`, `src/features/tracer/select/scan.test.ts`, `src/features/tracer/trace.ts`, `src/features/tracer/trace.test.ts`, `tests/helpers/trace.ts`
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- `traceStatement(stmt: ParsedStatement, db: DbClient, opts: TraceOptions): Promise<Trace>`
- `interface SelectStep { name: string; applies(ctx: SelectCtx): boolean; run(ctx: SelectCtx): Promise<void> }`, `SELECT_PIPELINE: SelectStep[]`, `runSelect(ctx)`
- `createSelectCtx(args): SelectCtx`, `keyOf`, `stageId`, `rangeOf(stmt, ...clauses)`, `outputIndex(node, out)`, `windowOf(ctx, keys)`, `alignToReference(ctx, keys)`
- `traceSql(db, sql, opts?)`, `summary(trace)`, `stageOf(trace, kind)`, `column(stage, name)` в `tests/helpers/trace.ts`

Допущение: `clauseRanges` (Ф4) отдаёт позиции в полном тексте редактора, в тех же координатах, что `ParsedStatement.from`. Если Ф4 отдаёт позиции относительно оператора, `rangeOf` прибавляет `stmt.from`; тест `filter.test.ts` про `sourceRange` это поймает.

- [ ] **Шаг 1.** Трекер: P5.5 ⬜ → 🔄.

- [ ] **Шаг 2. Хелпер тестов** `tests/helpers/trace.ts`:

```ts
import { introspect } from '@/features/db/introspect';
import type { DbClient } from '@/features/db/types';
import { initParser, parseSql } from '@/features/sql/parser';
import { traceStatement } from '@/features/tracer/trace';
import type { Stage, Trace, TraceOptions } from '@/features/tracer/types';

// Трасса первого оператора текста. Вызывать внутри inPreview
export async function traceSql(db: DbClient, sql: string, opts: Partial<TraceOptions> = {}): Promise<Trace> {
  await initParser();
  const parsed = parseSql(sql);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return traceStatement(parsed.statements[0], db, { ...opts, schema: opts.schema ?? (await introspect(db)) });
}

// Сводка трассы: 'scan:11 > filter:7 > project:7'
export function summary(trace: Trace): string {
  return trace.stages.map((s) => `${s.kind}:${s.rowCount ?? s.output.rows.length}`).join(' > ');
}

// Стадия нужного вида с сужением типа
export function stageOf<K extends Stage['kind']>(trace: Trace, kind: K): Extract<Stage, { kind: K }> {
  const stage = trace.stages.find((s) => s.kind === kind);
  if (!stage) throw new Error(`нет стадии ${kind}`);
  return stage as Extract<Stage, { kind: K }>;
}

// Значения строк стадии по колонке
export function column(stage: Stage, name: string): unknown[] {
  const i = stage.output.columns.findIndex((c) => c.name === name);
  return stage.output.rows.map((r) => r.values[i]);
}
```

- [ ] **Шаг 3. Падающие тесты** `src/features/tracer/select/scan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия scan', () => {
  it('строки таблицы с ctid в lineage и типами колонок', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const scan = stageOf(await traceSql(db, 'select * from book'), 'scan');
        expect(scan).toMatchObject({ alias: 'book', tableId: 'public.book', caption: 'FROM book: 11 строк' });
        expect(scan.output.rows).toHaveLength(11);
        expect(scan.output.rows[0]).toMatchObject({ key: 'book=(0,1)', lineage: { book: '(0,1)' } });
        expect(scan.output.columns.map((c) => `${c.name}:${c.type}`)).toEqual([
          'book_id:bigint', 'title:text', 'author_id:bigint', 'category_id:integer', 'price:numeric',
          'pages:integer', 'published_at:date', 'tags:text[]', 'meta:jsonb',
        ]);
      }),
    ));
  it('алиас в кавычках сохраняет регистр', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select * from book as "B"');
        expect(trace.mode).toBe('full');
        expect(stageOf(trace, 'scan').output.rows[0].key).toBe('B=(0,1)');
      }),
    ));
});
```

`src/features/tracer/trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../tests/helpers/trace';

describe('traceStatement', () => {
  it('ошибка Postgres → стадия error с фокусом на таблице', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select nme from book');
        expect(trace).toMatchObject({ mode: 'final-only', result: null, error: { code: '42703' } });
        expect(stageOf(trace, 'error').focus.tableIds).toEqual(['public.book']);
        // транзакция превью жива после ошибки
        expect((await db.query('select count(*)::int from book')).rows).toEqual([[11]]);
      }),
    ));
  it('команды транзакций не выполняются', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'rollback');
        expect(trace).toMatchObject({ mode: 'final-only', statementType: 'tcl', result: null, stages: [] });
      }),
    ));
  it('неподдерживаемый оператор: final-only с эталоном и touched', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*) from book');
        expect(trace).toMatchObject({ mode: 'final-only', fallbackReason: 'Пока не анимируется: агрегатные функции', stages: [] });
        expect(trace.result?.rows).toEqual([[11]]);
        expect(trace.touched.tableIds).toEqual(['public.book']);
      }),
    ));
  it('представление: final-only, у него нет ctid', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        await db.query('create view cheap as select title, price from book where price < 500');
        const trace = await traceSql(db, 'select * from cheap', { schema: await introspect(db) });
        expect(trace).toMatchObject({ mode: 'final-only', fallbackReason: 'Пока не анимируется: представление' });
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));
  it('отменённый signal прерывает трассу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(traceSql(db, 'select * from book', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      }),
    ));
});
```

- [ ] **Шаг 4. Запуск:** `pnpm vitest run --project node src/features/tracer/select/scan.test.ts src/features/tracer/trace.test.ts`. Ожидаемо: `Cannot find module '@/features/tracer/trace'` (через хелпер).

- [ ] **Шаг 5. Реализация** `src/features/tracer/select/context.ts`:

```ts
import type { Node, SelectStmt, SortBy } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import type { QueryResult } from '@/features/db/types';
import { clauseRanges } from '@/features/sql/clauses';
import type { ClauseName, ParsedStatement } from '@/features/sql/types';
import { ident, type Prober, sqlOf, typeNames } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { Column, Row, RowKey, SourceRange, Stage } from '../types';
import { canon, rowCanon } from '../verify';
import { alignWindow } from './align';

export interface Output {
  columns: Column[]; // выходные колонки запроса
  kinds: Array<{ kind: 'kept' | 'renamed' | 'computed'; column: string | null; expr: Node | null }>;
}

// Упорядоченная проекция P: одна проба даёт значения SELECT, порядок ORDER BY и значения ключей
export interface Ordered {
  order: RowKey[];
  values: Map<RowKey, unknown[]>;
  tuple: Map<RowKey, string>; // канон ключей сортировки строки
  sortKeys: string[];
  orderKeys: number[] | null; // выходные колонки-ключи (ведущие) для сверки порядка
}

export interface LimitParams { limit: number | null; offset: number; withTies: boolean }

export interface SelectCtx {
  stmt: ParsedStatement;
  sel: SelectStmt;
  prober: Prober;
  reference: QueryResult;
  volatile: boolean;
  table: TableInfo;
  alias: string; // алиас или имя таблицы, ключ lineage
  sql: { alias: string; lineage: string; from: string; where: string; targets: string };
  scanColumns: string[];
  columns: Column[];
  rows: Row[];
  stages: Stage[];
  outputs: () => Promise<Output>;
  ordered: () => Promise<Ordered>;
  limitParams: () => Promise<LimitParams>;
  typeNames: (oids: number[]) => Promise<Map<number, string>>;
}

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= fn();
    return p;
  };
}

export function createSelectCtx(args: {
  stmt: ParsedStatement;
  sel: SelectStmt;
  prober: Prober;
  reference: QueryResult;
  volatile: boolean;
  table: TableInfo;
  schema: SchemaSnapshot;
}): SelectCtx {
  const { sel, prober } = args;
  const rv = sel.fromClause?.[0];
  const alias = rv && 'RangeVar' in rv ? (rv.RangeVar.alias?.aliasname ?? rv.RangeVar.relname ?? '') : '';
  const a = ident(alias);
  const types = new Map<number, string>();
  const ctx: SelectCtx = {
    ...args,
    alias,
    sql: {
      alias: a,
      lineage: `${a}.ctid::text AS __vs_l0`,
      from: rv ? ` FROM ${sqlOf(rv)}` : '',
      where: sel.whereClause ? ` WHERE ${sqlOf(sel.whereClause)}` : '',
      targets: (sel.targetList ?? []).map(sqlOf).join(', '),
    },
    scanColumns: [],
    columns: [],
    rows: [],
    stages: [],
    typeNames: (oids) => typeNames(prober, oids, types),
    outputs: once(() => loadOutputs(ctx)),
    ordered: once(() => loadOrdered(ctx)),
    limitParams: once(() => loadLimitParams(ctx)),
  };
  return ctx;
}

export function keyOf(ctx: SelectCtx, ctid: string): RowKey {
  return rowKeyOf({ [ctx.alias]: ctid }, [ctx.alias]);
}

export function stageId(ctx: SelectCtx, kind: Stage['kind']): string {
  return `${ctx.stages.length}:${kind}`;
}

// Диапазон в редакторе: объединение нужных клауз
export function rangeOf(stmt: ParsedStatement, ...clauses: ClauseName[]): SourceRange | undefined {
  const found = clauseRanges(stmt).filter((r) => clauses.includes(r.clause));
  if (!found.length) return undefined;
  return { from: Math.min(...found.map((r) => r.from)), to: Math.max(...found.map((r) => r.to)) };
}

async function loadOutputs(ctx: SelectCtx): Promise<Output> {
  // Имена и типы выходных колонок отдаёт сам Postgres: звёздочки, неявные имена вроде upper, ?column?
  const probe = await ctx.prober.run(`SELECT ${ctx.sql.targets}${ctx.sql.from} LIMIT 0`);
  const types = await ctx.typeNames(probe.fields.map((f) => f.dataTypeID));
  const kinds: Output['kinds'] = [];
  for (const node of ctx.sel.targetList ?? []) {
    const rt = 'ResTarget' in node ? node.ResTarget : {};
    const ref = rt.val && 'ColumnRef' in rt.val ? rt.val.ColumnRef : null;
    const last = ref?.fields?.at(-1);
    if (last && 'A_Star' in last) {
      for (const column of ctx.scanColumns) kinds.push({ kind: 'kept', column, expr: null });
      continue;
    }
    const column = last && 'String' in last ? (last.String.sval ?? null) : null;
    if (column && ctx.scanColumns.includes(column)) kinds.push({ kind: 'kept', column, expr: rt.val ?? null });
    else kinds.push({ kind: 'computed', column: null, expr: rt.val ?? null });
  }
  const columns = probe.fields.map((f, i): Column => {
    const k = kinds[i];
    if (k.column && f.name !== k.column) k.kind = 'renamed';
    return {
      name: f.name,
      type: types.get(f.dataTypeID) ?? 'unknown',
      ...(k.column ? { source: { alias: ctx.alias, column: k.column } } : {}),
    };
  });
  return { columns, kinds };
}

// Ключ ORDER BY / DISTINCT ON → индекс выходной колонки (номер или имя выхода) или null (выражение над входом)
export function outputIndex(node: Node, out: Output): number | null {
  if ('A_Const' in node && node.A_Const.ival) return (node.A_Const.ival.ival ?? 0) - 1;
  const fields = 'ColumnRef' in node ? node.ColumnRef.fields : undefined;
  if (fields?.length === 1 && 'String' in fields[0]) {
    const i = out.columns.findIndex((c) => c.name === (fields[0] as { String: { sval?: string } }).String.sval);
    if (i >= 0) return i;
  }
  return null;
}

async function loadOrdered(ctx: SelectCtx): Promise<Ordered> {
  const out = await ctx.outputs();
  const n = out.columns.length;
  const extra: string[] = [];
  const orderParts: string[] = [];
  const tupleIdx: number[] = [];
  const orderKeys: number[] = [];
  let leading = true;
  for (const [i, node] of (ctx.sel.sortClause ?? []).entries()) {
    const sb: SortBy = 'SortBy' in node ? node.SortBy : {};
    const dir = sb.sortby_dir === 'SORTBY_DESC' ? ' DESC' : sb.sortby_dir === 'SORTBY_ASC' ? ' ASC' : '';
    const nulls = sb.sortby_nulls === 'SORTBY_NULLS_FIRST' ? ' NULLS FIRST' : sb.sortby_nulls === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : '';
    const idx = sb.node ? outputIndex(sb.node, out) : null;
    if (idx !== null) {
      orderParts.push(`${idx + 1}${dir}${nulls}`);
      tupleIdx.push(idx);
      if (leading) orderKeys.push(idx);
    } else {
      // Выражение считается один раз в той же пробе: random() даёт согласованный порядок
      extra.push(`(${sb.node ? sqlOf(sb.node) : 'NULL'}) AS __vs_k${i}`);
      orderParts.push(`__vs_k${i}${dir}${nulls}`);
      tupleIdx.push(n + extra.length);
      leading = false;
    }
  }
  // ctid последним ключом: порядок равных строк детерминирован
  orderParts.push(`${ctx.sql.alias}.ctid`);
  const extraSql = extra.map((e) => `, ${e}`).join('');
  const r = await ctx.prober.rows(
    `SELECT ${ctx.sql.targets}, ${ctx.sql.lineage}${extraSql}${ctx.sql.from}${ctx.sql.where} ORDER BY ${orderParts.join(', ')}`,
  );
  const order: RowKey[] = [];
  const values = new Map<RowKey, unknown[]>();
  const tuple = new Map<RowKey, string>();
  for (const row of r.rows) {
    const key = keyOf(ctx, row[n] as string);
    order.push(key);
    values.set(key, row.slice(0, n));
    tuple.set(key, tupleIdx.map((i) => canon(row[i])).join('\u0002'));
  }
  return {
    order,
    values,
    tuple,
    sortKeys: (ctx.sel.sortClause ?? []).map(sqlOf),
    orderKeys: orderKeys.length ? orderKeys : null,
  };
}

async function loadLimitParams(ctx: SelectCtx): Promise<LimitParams> {
  const { limitCount, limitOffset, limitOption } = ctx.sel;
  // Выражения LIMIT/OFFSET вычисляет Postgres; LIMIT ALL и LIMIT NULL дают NULL
  const r = await ctx.prober.run(
    `SELECT (${limitCount ? sqlOf(limitCount) : 'NULL'})::int8, (${limitOffset ? sqlOf(limitOffset) : '0'})::int8`,
  );
  const [limit, offset] = r.rows[0];
  return { limit: limit === null ? null : Number(limit), offset: Number(offset ?? 0), withTies: limitOption === 'LIMIT_OPTION_WITH_TIES' };
}

// Окно LIMIT/OFFSET над упорядоченными ключами; WITH TIES тянет конец по равным ключам
export async function windowOf(ctx: SelectCtx, keys: RowKey[]): Promise<{ from: number; to: number }> {
  const { limit, offset, withTies } = await ctx.limitParams();
  const ordered = await ctx.ordered();
  const from = Math.min(offset, keys.length);
  let to = limit === null ? keys.length : Math.min(keys.length, offset + limit);
  if (withTies && to > from) {
    const last = ordered.tuple.get(keys[to - 1]);
    while (to < keys.length && ordered.tuple.get(keys[to]) === last) to++;
  }
  return { from, to };
}

// Равные по ключам строки на границе окна выбираем так же, как выбрал Postgres в эталоне
export async function alignToReference(ctx: SelectCtx, keys: RowKey[]): Promise<RowKey[]> {
  if (ctx.volatile) return keys;
  const ordered = await ctx.ordered();
  const { from, to } = await windowOf(ctx, keys);
  return alignWindow(
    keys,
    (k) => (ctx.sel.sortClause ? (ordered.tuple.get(k) ?? '') : ''),
    (k) => rowCanon(ordered.values.get(k) ?? []),
    ctx.reference.rows.map(rowCanon),
    from,
    to,
  );
}
```

`src/features/tracer/select/scan.ts`:

```ts
import { captions } from '../captions';
import type { SelectStep } from './pipeline';
import { keyOf, rangeOf, stageId } from './context';

// FROM t: строки таблицы с ctid как lineage
export const scanStep: SelectStep = {
  name: 'scan',
  applies: () => true,
  async run(ctx) {
    const a = ctx.sql.alias;
    const r = await ctx.prober.rows(`SELECT ${ctx.sql.lineage}, ${a}.*${ctx.sql.from} ORDER BY ${a}.ctid`);
    const fields = r.fields.slice(1);
    const types = await ctx.typeNames(fields.map((f) => f.dataTypeID));
    ctx.scanColumns = fields.map((f) => f.name);
    ctx.columns = fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown', source: { alias: ctx.alias, column: f.name } }));
    ctx.rows = r.rows.map((row) => ({ key: keyOf(ctx, row[0] as string), lineage: { [ctx.alias]: row[0] as string }, values: row.slice(1) }));
    ctx.stages.push({
      id: stageId(ctx, 'scan'),
      kind: 'scan',
      alias: ctx.alias,
      tableId: ctx.table.id,
      sourceRange: rangeOf(ctx.stmt, 'from'),
      caption: captions.scan(ctx.table.name, ctx.alias, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

`src/features/tracer/select/pipeline.ts` (пока один шаг):

```ts
import type { SelectCtx } from './context';
import { scanStep } from './scan';

// Шаг SELECT в логическом порядке. Ф7 вставит join, group, having, Ф10 окна, ядро не меняется
export interface SelectStep {
  name: string;
  applies(ctx: SelectCtx): boolean;
  run(ctx: SelectCtx): Promise<void>;
}

export const SELECT_PIPELINE: SelectStep[] = [scanStep];

export async function runSelect(ctx: SelectCtx): Promise<void> {
  for (const step of SELECT_PIPELINE) if (step.applies(ctx)) await step.run(ctx);
}
```

`src/features/tracer/trace.ts` (без volatile и сжатого режима, они в задачах 12 и 13):

```ts
import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from './captions';
import { createProber, typeNames } from './probe';
import { resultKey } from './rowkey';
import { createSelectCtx, rangeOf } from './select/context';
import { runSelect } from './select/pipeline';
import type { Stage, Trace, TraceOptions } from './types';
import { sameResult } from './verify';
import { findTable, selectFeatures, touchedOf, unsupportedReason } from './whitelist';

// Вызывающий обязан обернуть вызов в sandbox.preview: транзакция уже открыта
export async function traceStatement(stmt: ParsedStatement, db: DbClient, opts: TraceOptions): Promise<Trace> {
  const started = performance.now();
  const prober = createProber(db, { signal: opts.signal, maxRows: opts.maxRows ?? 2000 });
  const touched = touchedOf(stmt.ast, opts.schema);
  const finish = (t: Pick<Trace, 'mode' | 'stages' | 'result' | 'error' | 'fallbackReason'>): Trace => ({
    sql: stmt.text,
    statementType: stmt.kind,
    touched,
    notices: [],
    ...t,
    timingMs: Math.round(performance.now() - started),
  });

  // COMMIT или ROLLBACK внутри превью сломал бы его транзакцию
  if (stmt.kind === 'tcl') {
    return finish({ mode: 'final-only', fallbackReason: 'Команды транзакций в превью не выполняются', stages: [], result: null, error: null });
  }

  // Эталон: оператор как есть. Ошибка Postgres → стадия error
  let reference: QueryResult;
  try {
    reference = await prober.run(stmt.text);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    const error = e.db;
    const stage: Stage = { id: '0:error', kind: 'error', error, focus: touched, caption: captions.error(error.code, error.message), output: { columns: [], rows: [] } };
    return finish({ mode: 'final-only', fallbackReason: 'Запрос завершился ошибкой', stages: [stage], result: null, error });
  }
  const finalOnly = (fallbackReason: string) => finish({ mode: 'final-only', fallbackReason, stages: [], result: reference, error: null });

  const reason = unsupportedReason(stmt);
  if (reason !== null) return finalOnly(reason);
  if (!('SelectStmt' in stmt.ast)) return finalOnly('Пока не анимируется');
  const sel = stmt.ast.SelectStmt;
  const volatile = selectFeatures(sel).has('volatile');

  // SELECT без FROM: одна стадия, значения прямо из эталона
  if (!sel.fromClause) {
    const types = await typeNames(prober, reference.fields.map((f) => f.dataTypeID), new Map());
    const columns = reference.fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown' }));
    const stage: Stage = {
      id: '0:project', kind: 'project', kept: [], removed: [], computed: columns.map((c) => c.name), renamed: {},
      sourceRange: rangeOf(stmt, 'select'), caption: captions.projectNoFrom(reference.rows.length),
      output: { columns, rows: reference.rows.map((values, i) => ({ key: resultKey(i), lineage: {}, values })) },
    };
    return finish({ mode: 'full', stages: [stage], result: reference, error: null });
  }

  const rv = sel.fromClause[0];
  const table = 'RangeVar' in rv ? findTable(opts.schema, rv.RangeVar.schemaname, rv.RangeVar.relname ?? '') : null;
  if (!table) return finalOnly('Таблица не найдена в схеме');
  // У представления нет ctid, у секций родителя ctid повторяются
  if (table.kind === 'view') return finalOnly('Пока не анимируется: представление');
  if (table.kind === 'partitioned') return finalOnly('Пока не анимируется: секционированная таблица');

  const args = { stmt, sel, prober, reference, volatile, table, schema: opts.schema };
  const ctx = createSelectCtx(args);
  try {
    await runSelect(ctx);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    return finalOnly(`Проба не удалась: ${e.db.message}`);
  }

  // Принцип честности: финальная стадия обязана совпасть с прямым выполнением
  const last = ctx.stages[ctx.stages.length - 1];
  const orderKeys = ctx.sel.sortClause ? (await ctx.ordered()).orderKeys : null;
  const ok = sameResult(last.output, reference, orderKeys);
  if (!ok) {
    if (import.meta.env?.DEV) console.warn('[tracer] сверка не сошлась', stmt.text);
    return finalOnly('Сверка с прямым выполнением не сошлась');
  }
  return finish({ mode: 'full', stages: ctx.stages, result: reference, error: null });
}
```

- [ ] **Шаг 6. Запуск:** та же команда. Ожидаемо: `Tests 7 passed (7)` (2 в `scan.test.ts`, 5 в `trace.test.ts`).

- [ ] **Шаг 7.** Трекер: P5.5 🔄 → ✅, P5.12 🔄 → ✅ (сверка подключена: `final-only` при расхождении, предупреждение в dev).

- [ ] **Шаг 8. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/context.ts src/features/tracer/select/pipeline.ts src/features/tracer/select/scan.ts src/features/tracer/select/scan.test.ts src/features/tracer/trace.ts src/features/tracer/trace.test.ts tests/helpers/trace.ts docs/PROGRESS.md
git commit -m "feat(tracer): ядро SELECT, стадия scan и сверка с прямым выполнением

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 7. Стадия filter с вердиктами (P5.6)

Проба без WHERE с колонкой `(<условие>) AS __vs_pred` отдаёт `true` / `false` / `null` по каждой строке. Остаются только `true`, порядок строк как у scan.

**Files:**
- Create: `src/features/tracer/select/filter.ts`, `src/features/tracer/select/filter.test.ts`
- Modify: `src/features/tracer/select/pipeline.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.6 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/select/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clauseRanges } from '@/features/sql/clauses';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия filter', () => {
  it('вердикты true / false / null, остаются только true', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const filter = stageOf(await traceSql(db, 'select * from book where price > 500'), 'filter');
        const verdicts = Object.values(filter.verdicts);
        expect([verdicts.filter((v) => v === true).length, verdicts.filter((v) => v === false).length, verdicts.filter((v) => v === null).length]).toEqual([7, 3, 1]);
        // «Остров погибших кораблей» без цены: UNKNOWN
        expect(filter.verdicts['book=(0,7)']).toBeNull();
        expect(filter.output.rows).toHaveLength(7);
        expect(filter.predicateColumns).toEqual(['price']);
        expect(filter.caption).toBe('WHERE: осталось 7 из 11 строк, UNKNOWN у 1');
      }),
    ));
  it('сравнение с NULL через = не пропускает ни одной строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const filter = stageOf(await traceSql(db, 'select * from book where price = null'), 'filter');
        expect(Object.values(filter.verdicts).every((v) => v === null)).toBe(true);
        expect(filter.output.rows).toHaveLength(0);
      }),
    ));
  it('sourceRange берётся из clauseRanges (кириллица перед WHERE)', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sql = 'select * from book as "Книга" where price > 500';
        await initParser();
        const parsed = parseSql(sql);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const where = clauseRanges(parsed.statements[0]).find((r) => r.clause === 'where');
        const trace = await traceSql(db, sql);
        expect(stageOf(trace, 'scan').output.rows[0].key).toBe('Книга=(0,1)');
        const filter = stageOf(trace, 'filter');
        expect(filter.sourceRange).toEqual({ from: where?.from, to: where?.to });
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/filter.test.ts`. Ожидаемо: 3 падения с `Error: нет стадии filter`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/filter.ts`:

```ts
import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { sqlOf } from '../probe';
import type { RowKey } from '../types';
import { walk } from '../whitelist';
import type { SelectStep } from './pipeline';
import { keyOf, rangeOf, stageId } from './context';

// WHERE: вердикт true / false / null по каждой строке, остаются только true
export const filterStep: SelectStep = {
  name: 'filter',
  applies: (ctx) => Boolean(ctx.sel.whereClause),
  async run(ctx) {
    const where = ctx.sel.whereClause as Node;
    const r = await ctx.prober.rows(`SELECT ${ctx.sql.lineage}, (${sqlOf(where)}) AS __vs_pred${ctx.sql.from}`);
    const verdicts: Record<RowKey, true | false | null> = {};
    for (const [ctid, verdict] of r.rows) verdicts[keyOf(ctx, ctid as string)] = verdict as boolean | null;
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => verdicts[row.key] === true);
    const predicateColumns = new Set<string>();
    walk(where, (key, value) => {
      if (key !== 'ColumnRef') return;
      const last = (value as { fields?: Node[] }).fields?.at(-1);
      const name = last && 'String' in last ? last.String.sval : undefined;
      if (name && ctx.scanColumns.includes(name)) predicateColumns.add(name);
    });
    ctx.stages.push({
      id: stageId(ctx, 'filter'),
      kind: 'filter',
      clause: 'where',
      verdicts,
      predicateColumns: [...predicateColumns],
      sourceRange: rangeOf(ctx.stmt, 'where'),
      caption: captions.filter(before, ctx.rows.length, Object.values(verdicts).filter((v) => v === null).length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

В `pipeline.ts` добавить импорт `import { filterStep } from './filter';` и шаг: `export const SELECT_PIPELINE: SelectStep[] = [scanStep, filterStep];`

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 3 passed (3)`.

- [ ] **Шаг 6.** Трекер: P5.6 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/filter.ts src/features/tracer/select/filter.test.ts src/features/tracer/select/pipeline.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия filter с вердиктами true / false / null

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 8. Стадия project: kept, removed, computed, renamed (P5.7)

Значения берутся из пробы P (`ctx.ordered()`), имена и типы выходных колонок из пробы `LIMIT 0` (`ctx.outputs()`): так Postgres сам раскрывает `*` и даёт неявные имена (`upper`, `?column?`). `ColumnRef` на колонку таблицы без смены имени = `kept`, со сменой = `renamed`, остальное `computed`. `projection()` вынесена отдельно, её переиспользует сжатый режим.

**Files:**
- Create: `src/features/tracer/select/project.ts`, `src/features/tracer/select/project.test.ts`
- Modify: `src/features/tracer/select/pipeline.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.7 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/select/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия project', () => {
  it('kept, removed, computed, renamed', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const project = stageOf(await traceSql(db, 'select title as name, price * 0.9 as sale, pages from book'), 'project');
        expect(project).toMatchObject({
          kept: ['pages'],
          removed: ['book_id', 'author_id', 'category_id', 'price', 'published_at', 'tags', 'meta'],
          computed: ['sale'],
          renamed: { title: 'name' },
          caption: 'SELECT: 2 колонки из 9, вычислено 1',
        });
        expect(project.output.columns[0]).toEqual({ name: 'name', type: 'text', source: { alias: 'book', column: 'title' } });
        expect(column(project, 'sale')[0]).toBe('801.000');
      }),
    ));
  it('звёздочка с алиасом оставляет все колонки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const project = stageOf(await traceSql(db, 'select b.* from book b where b.price between 400 and 700'), 'project');
        expect(project.kept).toHaveLength(9);
        expect(project.removed).toEqual([]);
        expect(project.output.rows.map((r) => r.key)).toEqual(['b=(0,4)', 'b=(0,6)', 'b=(0,8)', 'b=(0,9)']);
      }),
    ));
  it('SELECT без FROM: одна строка из эталона', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select 2 + 2 as answer');
        expect(trace.mode).toBe('full');
        expect(trace.stages).toHaveLength(1);
        expect(stageOf(trace, 'project').output.rows).toEqual([{ key: 'r:0', lineage: {}, values: [4] }]);
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/project.test.ts`. Ожидаемо: первые два теста падают с `Error: нет стадии project` (трасса `final-only`), третий (SELECT без FROM) проходит.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/project.ts`:

```ts
import { captions } from '../captions';
import type { SelectStep } from './pipeline';
import { type Output, rangeOf, stageId } from './context';

// Сводка проекции: kept / removed / computed / renamed относительно колонок таблицы
export function projection(out: Output, scanColumns: string[]) {
  const kept: string[] = [];
  const computed: string[] = [];
  const renamed: Record<string, string> = {};
  const used = new Set<string>();
  out.kinds.forEach((k, i) => {
    const name = out.columns[i].name;
    if (k.kind === 'computed') computed.push(name);
    else if (k.column) {
      used.add(k.column);
      if (k.kind === 'renamed') renamed[k.column] = name;
      else kept.push(name);
    }
  });
  return { kept, removed: scanColumns.filter((c) => !used.has(c)), computed, renamed };
}

// SELECT: какие колонки остались, какие вычислены и переименованы
export const projectStep: SelectStep = {
  name: 'project',
  applies: () => true,
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const p = projection(out, ctx.scanColumns);
    ctx.columns = out.columns;
    ctx.rows = ctx.rows.map((row) => ({ ...row, values: ordered.values.get(row.key) ?? [] }));
    ctx.stages.push({
      id: stageId(ctx, 'project'),
      kind: 'project',
      ...p,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: captions.project(p.kept.length + Object.keys(p.renamed).length, ctx.scanColumns.length, p.computed.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

В `pipeline.ts`: `import { projectStep } from './project';` и `[scanStep, filterStep, projectStep]`.

- [ ] **Шаг 5. Запуск:** та же команда, затем вся папка: `pnpm vitest run --project node src/features/tracer`. Ожидаемо: всё зелёное, `project.test.ts` `Tests 3 passed (3)`.

- [ ] **Шаг 6.** Трекер: P5.7 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/project.ts src/features/tracer/select/project.test.ts src/features/tracer/select/pipeline.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия project с kept / removed / computed / renamed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 9. Стадия distinct и DISTINCT ON (P5.8)

DISTINCT: группировка проекции по всем выходным колонкам (`GROUP BY` сводит NULL вместе, как DISTINCT). DISTINCT ON: группировка по выражениям ON над входом (номер или имя выхода разворачивается в его выражение). Участники стопки сортируются по порядку P, победитель первый. Если первые участники равны по ключам ORDER BY, победителем становится тот, чьи значения есть в эталоне, и он меняется местами с первым в порядке P.

**Files:**
- Create: `src/features/tracer/select/distinct.ts`, `src/features/tracer/select/distinct.test.ts`
- Modify: `src/features/tracer/select/pipeline.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.8 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/select/distinct.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rowCanon } from '../verify';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия distinct', () => {
  it('DISTINCT: стопки одинаковых значений, NULL в своей стопке', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const distinct = stageOf(await traceSql(db, 'select distinct city from customer'), 'distinct');
        expect(distinct.on).toBeNull();
        expect(distinct.stacks.map((s) => s.members.length).sort()).toEqual([1, 1, 2, 2]);
        expect(distinct.stacks.find((s) => s.winner === 'customer=(0,1)')?.members).toEqual(['customer=(0,1)', 'customer=(0,4)']);
        expect(column(distinct, 'city')).toEqual(['Москва', 'Казань', null, 'Санкт-Петербург']);
        expect(distinct.caption).toBe('DISTINCT: 6 строк → 4 уникальные');
      }),
    ));
  it('DISTINCT ON: победитель первый по ORDER BY, NULL при DESC первым', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select distinct on (category_id) title, category_id, price from book order by category_id, price desc');
        expect(trace.mode).toBe('full');
        const distinct = stageOf(trace, 'distinct');
        expect(distinct.on).toEqual(['category_id']);
        expect(distinct.stacks.find((s) => s.winner === 'book=(0,7)')?.members).toHaveLength(4);
        expect(column(stageOf(trace, 'sort'), 'title')).toEqual(['Остров погибших кораблей', 'Тихий Дон', 'Изучаем Python', 'Простой Python']);
      }),
    ));
  it('DISTINCT ON без полного порядка: победитель тот, что вернул Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select distinct on (category_id) category_id, title from book order by category_id');
        expect(trace.mode).toBe('full');
        const last = trace.stages[trace.stages.length - 1];
        expect(last.output.rows.map((r) => rowCanon(r.values)).sort()).toEqual((trace.result?.rows ?? []).map(rowCanon).sort());
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/distinct.test.ts`. Ожидаемо: падения с `Error: нет стадии distinct` и `expected 'final-only' to be 'full'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/distinct.ts`:

```ts
import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import type { RowKey } from '../types';
import { rowCanon } from '../verify';
import type { SelectStep } from './pipeline';
import { keyOf, outputIndex, rangeOf, stageId } from './context';

// DISTINCT и DISTINCT ON: стопки одинаковых строк, победитель первый по ORDER BY
export const distinctStep: SelectStep = {
  name: 'distinct',
  applies: (ctx) => Boolean(ctx.sel.distinctClause),
  async run(ctx) {
    const out = await ctx.outputs();
    const ordered = await ctx.ordered();
    const { sql } = ctx;
    const isOn = Object.keys((ctx.sel.distinctClause as Node[])[0]).length > 0;
    let groupsSql: string;
    let on: string[] | null = null;
    if (!isOn) {
      // Группы по всем выходным колонкам; GROUP BY сводит NULL вместе, как DISTINCT
      const cols = out.columns.map((_, i) => `c${i}`).join(', ');
      groupsSql = `SELECT array_agg(__vs_s.__vs_l0) FROM (SELECT ${sql.targets}, ${sql.lineage}${sql.from}${sql.where}) AS __vs_s(${cols}, __vs_l0) GROUP BY ${cols}`;
    } else {
      const nodes = ctx.sel.distinctClause as Node[];
      on = nodes.map(sqlOf);
      const exprs = nodes.map((node) => {
        const i = outputIndex(node, out);
        if (i === null) return sqlOf(node);
        const k = out.kinds[i];
        return k.expr ? sqlOf(k.expr) : `${sql.alias}.${ident(k.column ?? '')}`;
      });
      groupsSql = `SELECT array_agg(${sql.alias}.ctid::text)${sql.from}${sql.where} GROUP BY ${exprs.join(', ')}`;
    }
    const r = await ctx.prober.rows(groupsSql);
    const pos = new Map(ordered.order.map((k, i) => [k, i]));
    const inReference = new Set(ctx.reference.rows.map(rowCanon));
    const canonOf = (k: RowKey) => rowCanon(ordered.values.get(k) ?? []);
    const stacks = r.rows.map(([ctids]) => {
      const members = (ctids as string[]).map((c) => keyOf(ctx, c)).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
      // Среди равных по ORDER BY Postgres мог выбрать любую строку: берём ту, что есть в эталоне
      const tie = ordered.tuple.get(members[0]);
      const winner = members.find((m) => ordered.tuple.get(m) === tie && inReference.has(canonOf(m))) ?? members[0];
      if (winner !== members[0]) {
        const [wi, fi] = [ordered.order.indexOf(winner), ordered.order.indexOf(members[0])];
        [ordered.order[wi], ordered.order[fi]] = [ordered.order[fi], ordered.order[wi]];
      }
      return { winner, members: [winner, ...members.filter((m) => m !== winner)] };
    });
    const winners = new Set(stacks.map((s) => s.winner));
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => winners.has(row.key));
    ctx.stages.push({
      id: stageId(ctx, 'distinct'),
      kind: 'distinct',
      on,
      stacks,
      sourceRange: rangeOf(ctx.stmt, 'select'),
      caption: on ? captions.distinctOn(on, before, ctx.rows.length) : captions.distinct(before, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

В `pipeline.ts`: `import { distinctStep } from './distinct';` и `[scanStep, filterStep, projectStep, distinctStep]`.

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 2 failed | 1 passed (3)`. Тесты 2 и 3 (DISTINCT ON с ORDER BY) падают на `expected 'final-only' to be 'full'`: без стадии sort финал идёт в порядке scan и сверка порядка честно не проходит. Они закрываются в задаче 10. Остальные файлы `pnpm vitest run --project node src/features/tracer` зелёные.

- [ ] **Шаг 6. Коммит** (P5.8 остаётся 🔄 до зелёного теста в задаче 10; `pnpm check` здесь не запускается, коммит идёт вместе с задачей 10). Переходи к задаче 10 без коммита.

---

## Задача 10. Стадия sort (P5.9, закрывает P5.8)

Порядок строк = порядок пробы P (ORDER BY пользователя + `ctid` последним ключом), отфильтрованный по текущим строкам. Если дальше есть LIMIT/OFFSET, порядок выравнивается по эталону, чтобы «ножницы» резали непрерывный кусок.

**Files:**
- Create: `src/features/tracer/select/sort.ts`, `src/features/tracer/select/sort.test.ts`
- Modify: `src/features/tracer/select/pipeline.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.9 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/select/sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия sort', () => {
  it('DESC NULLS LAST: NULL в конце, ключи для подписи', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const sort = stageOf(await traceSql(db, 'select title, price from book order by price desc nulls last'), 'sort');
        expect(column(sort, 'price')).toEqual(['3200.00', '2400.00', '1990.00', '890.00', '610.00', '610.00', '560.00', '420.00', '350.00', '350.00', null]);
        expect(sort.sortKeys).toEqual(['price DESC NULLS LAST']);
        expect(sort.order).toEqual(sort.output.rows.map((r) => r.key));
        expect(sort.caption).toBe('ORDER BY price DESC NULLS LAST: 11 строк по порядку');
      }),
    ));
  it('по номеру колонки, по алиасу и по колонке вне SELECT', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const byNumber = stageOf(await traceSql(db, 'select title, price from book order by 2 desc, title'), 'sort');
        expect(column(byNumber, 'title').slice(0, 2)).toEqual(['Остров погибших кораблей', 'Изучаем Python']);
        const byAlias = stageOf(await traceSql(db, 'select title, price * 2 as p from book order by p'), 'sort');
        expect(column(byAlias, 'p')[0]).toBe('700.00');
        const hidden = await traceSql(db, 'select title from book order by price desc nulls last');
        expect(hidden.mode).toBe('full');
        expect(column(stageOf(hidden, 'sort'), 'title')[0]).toBe('Изучаем Python');
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/sort.test.ts`. Ожидаемо: `Error: нет стадии sort`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/sort.ts`:

```ts
import { captions } from '../captions';
import type { SelectStep } from './pipeline';
import { alignToReference, rangeOf, stageId } from './context';

// ORDER BY: позиции строк из упорядоченной проекции P (ключ ctid последним)
export const sortStep: SelectStep = {
  name: 'sort',
  applies: (ctx) => Boolean(ctx.sel.sortClause),
  async run(ctx) {
    const ordered = await ctx.ordered();
    const present = new Set(ctx.rows.map((r) => r.key));
    let order = ordered.order.filter((k) => present.has(k));
    if (ctx.sel.limitCount || ctx.sel.limitOffset) order = await alignToReference(ctx, order);
    const byKey = new Map(ctx.rows.map((r) => [r.key, r]));
    ctx.rows = order.flatMap((k) => byKey.get(k) ?? []);
    ctx.stages.push({
      id: stageId(ctx, 'sort'),
      kind: 'sort',
      order,
      sortKeys: ordered.sortKeys,
      sourceRange: rangeOf(ctx.stmt, 'order'),
      caption: captions.sort(ordered.sortKeys, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

В `pipeline.ts`: `import { sortStep } from './sort';` и `[scanStep, filterStep, projectStep, distinctStep, sortStep]`.

- [ ] **Шаг 5. Запуск:** `pnpm vitest run --project node src/features/tracer/select/sort.test.ts src/features/tracer/select/distinct.test.ts`. Ожидаемо: `Tests 5 passed (5)`.

- [ ] **Шаг 6.** Трекер: P5.8 🔄 → ✅, P5.9 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/distinct.ts src/features/tracer/select/distinct.test.ts src/features/tracer/select/sort.ts src/features/tracer/select/sort.test.ts src/features/tracer/select/pipeline.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадии distinct, DISTINCT ON и sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 11. Стадия limit: LIMIT, OFFSET, FETCH FIRST, WITH TIES (P5.10)

Выражения LIMIT и OFFSET вычисляет Postgres одной пробой `SELECT (<count>)::int8, (<offset>)::int8` (LIMIT ALL и LIMIT NULL дают NULL). Окно считается в JS. WITH TIES читается из `limitOption` AST и тянет конец окна, пока кортеж ключей сортировки равен последнему оставленному. Без ORDER BY порядок не задан, поэтому строки окна выравниваются по эталону прямо здесь.

**Files:**
- Create: `src/features/tracer/select/limit.ts`, `src/features/tracer/select/limit.test.ts`
- Modify: `src/features/tracer/select/pipeline.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.10 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест** `src/features/tracer/select/limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, traceSql } from '../../../../tests/helpers/trace';

describe('стадия limit', () => {
  it('OFFSET и LIMIT: окно и отрезанные строки', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const limit = stageOf(await traceSql(db, 'select title, price from book order by price limit 3 offset 2'), 'limit');
        expect(limit).toMatchObject({ limit: 3, offset: 2, caption: 'OFFSET 2, LIMIT 3: осталось 3 из 11 строк' });
        expect(limit.kept).toHaveLength(3);
        expect(limit.cut).toHaveLength(8);
        expect(column(limit, 'price')).toEqual(['420.00', '560.00', '610.00']);
      }),
    ));
  it('FETCH FIRST WITH TIES тянет равные строки (депарсер целого запроса теряет WITH TIES)', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, price from book order by price fetch first 1 row with ties');
        expect(trace.mode).toBe('full');
        const limit = stageOf(trace, 'limit');
        expect(column(limit, 'price')).toEqual(['350.00', '350.00']);
        expect(limit.caption).toBe('FETCH FIRST 1 WITH TIES: осталось 2 из 11 строк');
      }),
    ));
  it('ничья на границе OFFSET: внутрь окна попадает та строка, что вернул Postgres', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book order by price limit 4 offset 1');
        expect(trace.mode).toBe('full');
        expect(column(stageOf(trace, 'limit'), 'title')).toEqual((trace.result?.rows ?? []).map((r) => r[0]));
      }),
    ));
  it('LIMIT ALL, LIMIT 0 и OFFSET без LIMIT', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        expect(stageOf(await traceSql(db, 'select * from book limit all'), 'limit')).toMatchObject({ limit: null, offset: 0, kept: expect.any(Array) });
        expect(stageOf(await traceSql(db, 'select * from book limit 0'), 'limit').kept).toEqual([]);
        const offset = stageOf(await traceSql(db, 'select title from book offset 9'), 'limit');
        expect(offset).toMatchObject({ limit: null, offset: 9, caption: 'OFFSET 9: осталось 2 из 11 строк' });
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/limit.test.ts`. Ожидаемо: `Error: нет стадии limit` и `expected 'final-only' to be 'full'`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/limit.ts`:

```ts
import { captions, limitLabel } from '../captions';
import type { SelectStep } from './pipeline';
import { alignToReference, rangeOf, stageId, windowOf } from './context';

// LIMIT / OFFSET / FETCH FIRST: окно над текущим порядком строк
export const limitStep: SelectStep = {
  name: 'limit',
  applies: (ctx) => Boolean(ctx.sel.limitCount || ctx.sel.limitOffset),
  async run(ctx) {
    let keys = ctx.rows.map((r) => r.key);
    // Без ORDER BY порядок не задан: строки окна берём те, что вернул Postgres
    if (!ctx.sel.sortClause) keys = await alignToReference(ctx, keys);
    const { from, to } = await windowOf(ctx, keys);
    const { limit, offset, withTies } = await ctx.limitParams();
    const kept = keys.slice(from, to);
    const keptSet = new Set(kept);
    const byKey = new Map(ctx.rows.map((r) => [r.key, r]));
    const before = ctx.rows.length;
    ctx.rows = kept.flatMap((k) => byKey.get(k) ?? []);
    ctx.stages.push({
      id: stageId(ctx, 'limit'),
      kind: 'limit',
      kept,
      cut: keys.filter((k) => !keptSet.has(k)),
      limit,
      offset,
      sourceRange: rangeOf(ctx.stmt, 'limit', 'offset'),
      caption: captions.limit(limitLabel(limit, offset, withTies), before, ctx.rows.length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

`src/features/tracer/select/pipeline.ts` целиком:

```ts
import { distinctStep } from './distinct';
import { filterStep } from './filter';
import { limitStep } from './limit';
import { projectStep } from './project';
import { scanStep } from './scan';
import type { SelectCtx } from './context';
import { sortStep } from './sort';

// Шаг SELECT в логическом порядке. Ф7 вставит join, group, having, Ф10 окна, ядро не меняется
export interface SelectStep {
  name: string;
  applies(ctx: SelectCtx): boolean;
  run(ctx: SelectCtx): Promise<void>;
}

export const SELECT_PIPELINE: SelectStep[] = [scanStep, filterStep, projectStep, distinctStep, sortStep, limitStep];

export async function runSelect(ctx: SelectCtx): Promise<void> {
  for (const step of SELECT_PIPELINE) if (step.applies(ctx)) await step.run(ctx);
}
```

- [ ] **Шаг 5. Запуск:** та же команда, затем `pnpm vitest run --project node src/features/tracer`. Ожидаемо: `limit.test.ts` `Tests 4 passed (4)`, вся папка зелёная.

- [ ] **Шаг 6.** Трекер: P5.10 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/limit.ts src/features/tracer/select/limit.test.ts src/features/tracer/select/pipeline.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия limit с OFFSET и WITH TIES

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 12. Volatile-функции (P5.13)

`random()` и подобные в SELECT и ORDER BY считаются один раз в пробе P, все стадии от project берут значения оттуда и помечены `volatile`. Прямое выполнение остаётся эталоном для ошибок и панели результата, сверка для volatile идёт по числу строк. Volatile в WHERE, DISTINCT, LIMIT уже уходит в `final-only` (задача 2).

**Files:**
- Modify: `src/features/tracer/trace.ts`, `src/features/tracer/trace.test.ts`, `src/features/tracer/select/project.ts`, `src/features/tracer/select/sort.ts`, `src/features/tracer/select/limit.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.13 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест.** В `trace.test.ts` поменять импорт хелпера на `import { column, stageOf, traceSql } from '../../../tests/helpers/trace';` и добавить в `describe` перед тестом про signal:

```ts
  it('volatile: одно вычисление на все стадии, метка volatile', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, random() as r from book order by r limit 3');
        expect(trace.mode).toBe('full');
        expect(trace.stages.map((s) => `${s.kind}:${s.volatile ?? false}`)).toEqual(['scan:false', 'project:true', 'sort:true', 'limit:true']);
        const r = column(stageOf(trace, 'sort'), 'r') as number[];
        expect([...r].sort((a, b) => a - b)).toEqual(r);
        expect(column(stageOf(trace, 'limit'), 'r')).toEqual(r.slice(0, 3));
      }),
    ));
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/trace.test.ts`. Ожидаемо: `expected 'final-only' to be 'full'` (без ветки volatile сверка расходится: эталон и проба дали разные `random()`).

- [ ] **Шаг 4. Реализация.** В `project.ts`, `sort.ts`, `limit.ts` в объект стадии перед строкой `sourceRange: rangeOf(...)` добавить строку:

```ts
      volatile: ctx.volatile || undefined,
```

`src/features/tracer/trace.ts` целиком (добавлены метка у SELECT без FROM и ветка сверки volatile):

```ts
import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from './captions';
import { createProber, typeNames } from './probe';
import { resultKey } from './rowkey';
import { createSelectCtx, rangeOf } from './select/context';
import { runSelect } from './select/pipeline';
import type { Stage, Trace, TraceOptions } from './types';
import { sameResult } from './verify';
import { findTable, selectFeatures, touchedOf, unsupportedReason } from './whitelist';

// Вызывающий обязан обернуть вызов в sandbox.preview: транзакция уже открыта
export async function traceStatement(stmt: ParsedStatement, db: DbClient, opts: TraceOptions): Promise<Trace> {
  const started = performance.now();
  const prober = createProber(db, { signal: opts.signal, maxRows: opts.maxRows ?? 2000 });
  const touched = touchedOf(stmt.ast, opts.schema);
  const finish = (t: Pick<Trace, 'mode' | 'stages' | 'result' | 'error' | 'fallbackReason'>): Trace => ({
    sql: stmt.text,
    statementType: stmt.kind,
    touched,
    notices: [],
    ...t,
    timingMs: Math.round(performance.now() - started),
  });

  // COMMIT или ROLLBACK внутри превью сломал бы его транзакцию
  if (stmt.kind === 'tcl') {
    return finish({ mode: 'final-only', fallbackReason: 'Команды транзакций в превью не выполняются', stages: [], result: null, error: null });
  }

  // Эталон: оператор как есть. Ошибка Postgres → стадия error
  let reference: QueryResult;
  try {
    reference = await prober.run(stmt.text);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    const error = e.db;
    const stage: Stage = { id: '0:error', kind: 'error', error, focus: touched, caption: captions.error(error.code, error.message), output: { columns: [], rows: [] } };
    return finish({ mode: 'final-only', fallbackReason: 'Запрос завершился ошибкой', stages: [stage], result: null, error });
  }
  const finalOnly = (fallbackReason: string) => finish({ mode: 'final-only', fallbackReason, stages: [], result: reference, error: null });

  const reason = unsupportedReason(stmt);
  if (reason !== null) return finalOnly(reason);
  if (!('SelectStmt' in stmt.ast)) return finalOnly('Пока не анимируется');
  const sel = stmt.ast.SelectStmt;
  const volatile = selectFeatures(sel).has('volatile');

  // SELECT без FROM: одна стадия, значения прямо из эталона
  if (!sel.fromClause) {
    const types = await typeNames(prober, reference.fields.map((f) => f.dataTypeID), new Map());
    const columns = reference.fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown' }));
    const stage: Stage = {
      id: '0:project', kind: 'project', kept: [], removed: [], computed: columns.map((c) => c.name), renamed: {},
      volatile: volatile || undefined, sourceRange: rangeOf(stmt, 'select'), caption: captions.projectNoFrom(reference.rows.length),
      output: { columns, rows: reference.rows.map((values, i) => ({ key: resultKey(i), lineage: {}, values })) },
    };
    return finish({ mode: 'full', stages: [stage], result: reference, error: null });
  }

  const rv = sel.fromClause[0];
  const table = 'RangeVar' in rv ? findTable(opts.schema, rv.RangeVar.schemaname, rv.RangeVar.relname ?? '') : null;
  if (!table) return finalOnly('Таблица не найдена в схеме');
  // У представления нет ctid, у секций родителя ctid повторяются
  if (table.kind === 'view') return finalOnly('Пока не анимируется: представление');
  if (table.kind === 'partitioned') return finalOnly('Пока не анимируется: секционированная таблица');

  const args = { stmt, sel, prober, reference, volatile, table, schema: opts.schema };
  const ctx = createSelectCtx(args);
  try {
    await runSelect(ctx);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    return finalOnly(`Проба не удалась: ${e.db.message}`);
  }

  // Принцип честности: финальная стадия обязана совпасть с прямым выполнением
  const last = ctx.stages[ctx.stages.length - 1];
  const orderKeys = ctx.sel.sortClause ? (await ctx.ordered()).orderKeys : null;
  const ok = volatile
    ? last.output.rows.length === reference.rows.length // значения volatile пересчитаны, сверяем число строк
    : sameResult(last.output, reference, orderKeys);
  if (!ok) {
    if (import.meta.env?.DEV) console.warn('[tracer] сверка не сошлась', stmt.text);
    return finalOnly('Сверка с прямым выполнением не сошлась');
  }
  return finish({ mode: 'full', stages: ctx.stages, result: reference, error: null });
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 6 passed (6)`. Затем `pnpm vitest run --project node src/features/tracer` зелёный.

- [ ] **Шаг 6.** Трекер: P5.13 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/trace.ts src/features/tracer/trace.test.ts src/features/tracer/select/project.ts src/features/tracer/select/sort.ts src/features/tracer/select/limit.ts docs/PROGRESS.md
git commit -m "feat(tracer): volatile-функции считаются одной пробой

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 13. Лимит строк и сжатый режим (P5.14)

Любая строковая проба больше `maxRows` (по умолчанию 2000) бросает `ProbeOverflow`. Трасса пересобирается в сжатом режиме: те же стадии, `compressed: true`, `output.rows` пуст, `rowCount` точный из проб `count(*)`. Итог окна LIMIT берётся у прямого выполнения. Сверка в сжатом режиме: `rowCount` последней стадии равен числу строк эталона. Тест использует `maxRows: 5` на bookstore, отдельный большой датасет не нужен.

**Files:**
- Create: `src/features/tracer/select/compressed.ts`
- Modify: `src/features/tracer/trace.ts`, `src/features/tracer/trace.test.ts`, `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.14 ⬜ → 🔄.

- [ ] **Шаг 2. Падающий тест.** В `trace.test.ts` импорт хелпера: `import { column, stageOf, summary, traceSql } from '../../../tests/helpers/trace';`, в `describe` перед тестом про signal:

```ts
  it('больше maxRows строк → сжатый режим с точными счётчиками', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title from book where price > 500 order by price limit 3', { maxRows: 5 });
        expect(trace.mode).toBe('full');
        expect(summary(trace)).toBe('scan:11 > filter:7 > project:7 > sort:7 > limit:3');
        expect(trace.stages.every((s) => s.compressed && s.output.rows.length === 0)).toBe(true);
        expect(trace.result?.rows).toHaveLength(3);
      }),
    ));
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/trace.test.ts`. Ожидаемо: тест падает с `ProbeOverflow: probe overflow`.

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/compressed.ts`:

```ts
import type { Node } from '@pgsql/types';
import { captions, limitLabel } from '../captions';
import { sqlOf } from '../probe';
import type { Column, Stage } from '../types';
import { rangeOf, type SelectCtx, stageId } from './context';
import { projection } from './project';

// Сжатый режим: таблица больше maxRows. Стадии без строк, только точные счётчики (оверлей рисует полосы)
export async function runCompressed(ctx: SelectCtx): Promise<void> {
  const { sql, sel } = ctx;
  const count = async (q: string) => Number((await ctx.prober.run(`SELECT count(*) FROM (${q}) AS __vs_c`)).rows[0][0]);
  const base = (kind: Stage['kind'], columns: Column[]) => ({ id: stageId(ctx, kind), compressed: true, output: { columns, rows: [] } });

  const head = await ctx.prober.run(`SELECT ${sql.alias}.*${sql.from} LIMIT 0`);
  const types = await ctx.typeNames(head.fields.map((f) => f.dataTypeID));
  ctx.scanColumns = head.fields.map((f) => f.name);
  const scanCols = head.fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown', source: { alias: ctx.alias, column: f.name } }));
  let n = await count(`SELECT 1${sql.from}`);
  ctx.stages.push({ ...base('scan', scanCols), kind: 'scan', alias: ctx.alias, tableId: ctx.table.id, rowCount: n, sourceRange: rangeOf(ctx.stmt, 'from'), caption: captions.scan(ctx.table.name, ctx.alias, n) });

  if (sel.whereClause) {
    const before = n;
    n = await count(`SELECT 1${sql.from}${sql.where}`);
    ctx.stages.push({ ...base('filter', scanCols), kind: 'filter', clause: 'where', verdicts: {}, predicateColumns: [], rowCount: n, sourceRange: rangeOf(ctx.stmt, 'where'), caption: captions.filter(before, n, 0) });
  }

  const out = await ctx.outputs();
  const p = projection(out, ctx.scanColumns);
  ctx.stages.push({ ...base('project', out.columns), kind: 'project', ...p, rowCount: n, sourceRange: rangeOf(ctx.stmt, 'select'), caption: captions.project(p.kept.length + Object.keys(p.renamed).length, ctx.scanColumns.length, p.computed.length) });

  if (sel.distinctClause) {
    const nodes = sel.distinctClause as Node[];
    const on = Object.keys(nodes[0]).length ? nodes.map(sqlOf) : null;
    const before = n;
    n = await count(`SELECT DISTINCT${on ? ` ON (${on.join(', ')})` : ''} ${sql.targets}${sql.from}${sql.where}`);
    ctx.stages.push({ ...base('distinct', out.columns), kind: 'distinct', on, stacks: [], rowCount: n, sourceRange: rangeOf(ctx.stmt, 'select'), caption: on ? captions.distinctOn(on, before, n) : captions.distinct(before, n) });
  }
  if (sel.sortClause) {
    const sortKeys = sel.sortClause.map(sqlOf);
    ctx.stages.push({ ...base('sort', out.columns), kind: 'sort', order: [], sortKeys, rowCount: n, sourceRange: rangeOf(ctx.stmt, 'order'), caption: captions.sort(sortKeys, n) });
  }
  if (sel.limitCount || sel.limitOffset) {
    const { limit, offset, withTies } = await ctx.limitParams();
    const before = n;
    // Итог окна (в том числе WITH TIES) берём у прямого выполнения
    n = ctx.reference.rows.length;
    ctx.stages.push({ ...base('limit', out.columns), kind: 'limit', kept: [], cut: [], limit, offset, rowCount: n, sourceRange: rangeOf(ctx.stmt, 'limit', 'offset'), caption: captions.limit(limitLabel(limit, offset, withTies), before, n) });
  }
}
```

`src/features/tracer/trace.ts` целиком (ветка `ProbeOverflow`):

```ts
import { type DbClient, DbException, type QueryResult } from '@/features/db/types';
import type { ParsedStatement } from '@/features/sql/types';
import { captions } from './captions';
import { createProber, ProbeOverflow, typeNames } from './probe';
import { resultKey } from './rowkey';
import { createSelectCtx, rangeOf } from './select/context';
import { runCompressed } from './select/compressed';
import { runSelect } from './select/pipeline';
import type { Stage, Trace, TraceOptions } from './types';
import { sameResult } from './verify';
import { findTable, selectFeatures, touchedOf, unsupportedReason } from './whitelist';

// Вызывающий обязан обернуть вызов в sandbox.preview: транзакция уже открыта
export async function traceStatement(stmt: ParsedStatement, db: DbClient, opts: TraceOptions): Promise<Trace> {
  const started = performance.now();
  const prober = createProber(db, { signal: opts.signal, maxRows: opts.maxRows ?? 2000 });
  const touched = touchedOf(stmt.ast, opts.schema);
  const finish = (t: Pick<Trace, 'mode' | 'stages' | 'result' | 'error' | 'fallbackReason'>): Trace => ({
    sql: stmt.text,
    statementType: stmt.kind,
    touched,
    notices: [],
    ...t,
    timingMs: Math.round(performance.now() - started),
  });

  // COMMIT или ROLLBACK внутри превью сломал бы его транзакцию
  if (stmt.kind === 'tcl') {
    return finish({ mode: 'final-only', fallbackReason: 'Команды транзакций в превью не выполняются', stages: [], result: null, error: null });
  }

  // Эталон: оператор как есть. Ошибка Postgres → стадия error
  let reference: QueryResult;
  try {
    reference = await prober.run(stmt.text);
  } catch (e) {
    if (!(e instanceof DbException)) throw e;
    const error = e.db;
    const stage: Stage = { id: '0:error', kind: 'error', error, focus: touched, caption: captions.error(error.code, error.message), output: { columns: [], rows: [] } };
    return finish({ mode: 'final-only', fallbackReason: 'Запрос завершился ошибкой', stages: [stage], result: null, error });
  }
  const finalOnly = (fallbackReason: string) => finish({ mode: 'final-only', fallbackReason, stages: [], result: reference, error: null });

  const reason = unsupportedReason(stmt);
  if (reason !== null) return finalOnly(reason);
  if (!('SelectStmt' in stmt.ast)) return finalOnly('Пока не анимируется');
  const sel = stmt.ast.SelectStmt;
  const volatile = selectFeatures(sel).has('volatile');

  // SELECT без FROM: одна стадия, значения прямо из эталона
  if (!sel.fromClause) {
    const types = await typeNames(prober, reference.fields.map((f) => f.dataTypeID), new Map());
    const columns = reference.fields.map((f) => ({ name: f.name, type: types.get(f.dataTypeID) ?? 'unknown' }));
    const stage: Stage = {
      id: '0:project', kind: 'project', kept: [], removed: [], computed: columns.map((c) => c.name), renamed: {},
      volatile: volatile || undefined, sourceRange: rangeOf(stmt, 'select'), caption: captions.projectNoFrom(reference.rows.length),
      output: { columns, rows: reference.rows.map((values, i) => ({ key: resultKey(i), lineage: {}, values })) },
    };
    return finish({ mode: 'full', stages: [stage], result: reference, error: null });
  }

  const rv = sel.fromClause[0];
  const table = 'RangeVar' in rv ? findTable(opts.schema, rv.RangeVar.schemaname, rv.RangeVar.relname ?? '') : null;
  if (!table) return finalOnly('Таблица не найдена в схеме');
  // У представления нет ctid, у секций родителя ctid повторяются
  if (table.kind === 'view') return finalOnly('Пока не анимируется: представление');
  if (table.kind === 'partitioned') return finalOnly('Пока не анимируется: секционированная таблица');

  const args = { stmt, sel, prober, reference, volatile, table, schema: opts.schema };
  let ctx = createSelectCtx(args);
  try {
    await runSelect(ctx);
  } catch (e) {
    if (e instanceof ProbeOverflow) {
      ctx = createSelectCtx(args);
      await runCompressed(ctx);
      const ok = ctx.stages.at(-1)?.rowCount === reference.rows.length;
      return ok ? finish({ mode: 'full', stages: ctx.stages, result: reference, error: null }) : finalOnly('Сверка с прямым выполнением не сошлась');
    }
    if (!(e instanceof DbException)) throw e;
    return finalOnly(`Проба не удалась: ${e.db.message}`);
  }

  // Принцип честности: финальная стадия обязана совпасть с прямым выполнением
  const last = ctx.stages[ctx.stages.length - 1];
  const orderKeys = ctx.sel.sortClause ? (await ctx.ordered()).orderKeys : null;
  const ok = volatile
    ? last.output.rows.length === reference.rows.length // значения volatile пересчитаны, сверяем число строк
    : sameResult(last.output, reference, orderKeys);
  if (!ok) {
    if (import.meta.env?.DEV) console.warn('[tracer] сверка не сошлась', stmt.text);
    return finalOnly('Сверка с прямым выполнением не сошлась');
  }
  return finish({ mode: 'full', stages: ctx.stages, result: reference, error: null });
}
```

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 7 passed (7)`.

- [ ] **Шаг 6.** Трекер: P5.14 🔄 → ✅.

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/compressed.ts src/features/tracer/trace.ts src/features/tracer/trace.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): лимит строк на стадию и сжатый режим

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 14. Golden-харнесс и закрытие фазы (P5.15)

58 запросов главы 4 (выборка из одной таблицы): каждый обязан дать `full` (значит, сверка прошла) и ровно такие стадии. Ожидаемые сводки сняты прогоном на bookstore. Ф8 добавляет сюда запросы уроков главы 4, Ф7 и Ф10 свои.

**Files:**
- Create: `tests/tracer/golden.queries.ts`, `tests/tracer/golden.test.ts`
- Modify: `docs/PROGRESS.md`

- [ ] **Шаг 1.** Трекер: P5.15 ⬜ → 🔄.

- [ ] **Шаг 2. Набор** `tests/tracer/golden.queries.ts`:

```ts
// Golden-набор Ф5: запрос → ожидаемые стадии. Значения сняты прогоном на bookstore (PGlite 0.5.8).
// Ф8 добавляет сюда запросы уроков главы 4, Ф7 и Ф10 свои.
export const GOLDEN: Array<{ sql: string; stages: string }> = [
  { sql: 'select * from book', stages: 'scan:11 > project:11' },
  { sql: 'select title, price from book', stages: 'scan:11 > project:11' },
  { sql: 'select title as name, price * 0.9 as sale from book', stages: 'scan:11 > project:11' },
  { sql: 'select title, price from book where price > 500', stages: 'scan:11 > filter:7 > project:7' },
  { sql: 'select title, price from book where price > 500 or pages < 100', stages: 'scan:11 > filter:9 > project:9' },
  { sql: 'select * from book where author_id is null', stages: 'scan:11 > filter:2 > project:2' },
  { sql: 'select * from book where price = null', stages: 'scan:11 > filter:0 > project:0' },
  { sql: "select * from customer where city <> 'Москва'", stages: 'scan:6 > filter:3 > project:3' },
  { sql: "select name, coalesce(city, 'не указан') as city from customer", stages: 'scan:6 > project:6' },
  { sql: 'select title, price from book order by price', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price from book order by price desc nulls last', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price from book order by 2 desc, title', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title from book order by price desc nulls last', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price * 2 as p from book order by p', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, price from book order by price desc nulls last limit 3', stages: 'scan:11 > project:11 > sort:11 > limit:3' },
  { sql: 'select title, price from book order by price limit 3 offset 2', stages: 'scan:11 > project:11 > sort:11 > limit:3' },
  { sql: 'select title, price from book order by price fetch first 3 rows with ties', stages: 'scan:11 > project:11 > sort:11 > limit:3' },
  { sql: 'select title from book limit 3', stages: 'scan:11 > project:11 > limit:3' },
  { sql: 'select title from book offset 9', stages: 'scan:11 > project:11 > limit:2' },
  { sql: 'select * from book limit all', stages: 'scan:11 > project:11 > limit:11' },
  { sql: 'select * from book limit 0', stages: 'scan:11 > project:11 > limit:0' },
  { sql: 'select distinct city from customer', stages: 'scan:6 > project:6 > distinct:4' },
  { sql: 'select distinct city from customer order by city', stages: 'scan:6 > project:6 > distinct:4 > sort:4' },
  { sql: 'select distinct on (category_id) title, category_id, price from book order by category_id, price desc', stages: 'scan:11 > project:11 > distinct:4 > sort:4' },
  { sql: 'select distinct name from customer', stages: 'scan:6 > project:6 > distinct:5' },
  { sql: 'select 2 + 2 as answer', stages: 'project:1' },
  { sql: 'select title, random() as r from book', stages: 'scan:11 > project:11' },
  { sql: 'select title from book order by random() limit 1', stages: 'scan:11 > project:11 > sort:11 > limit:1' },
  { sql: "select title, upper(title), length(title) from book where title ilike '%python%'", stages: 'scan:11 > filter:3 > project:3' },
  { sql: 'select b.* from book b where b.price between 400 and 700', stages: 'scan:11 > filter:4 > project:4' },
  { sql: 'select title, price from book where price in (350, 610) order by price, title', stages: 'scan:11 > filter:4 > project:4 > sort:4' },
  { sql: "select name from customer where city is distinct from 'Москва'", stages: 'scan:6 > filter:4 > project:4' },
  { sql: 'select title from book where not (price > 1000)', stages: 'scan:11 > filter:7 > project:7' },
  { sql: 'select title, pages from book order by pages desc limit 2 offset 1', stages: 'scan:11 > project:11 > sort:11 > limit:2' },
  { sql: 'select title from book as "B"', stages: 'scan:11 > project:11' },
  { sql: "select * from public.book b where b.title like '%Python%' order by b.price desc", stages: 'scan:11 > filter:3 > project:3 > sort:3' },
  { sql: 'select title, price from book order by price nulls first limit 2', stages: 'scan:11 > project:11 > sort:11 > limit:2' },
  { sql: 'select title from book where pages > 300 and price < 1000 order by title desc offset 1 limit 2', stages: 'scan:11 > filter:3 > project:3 > sort:3 > limit:2' },
  { sql: 'select distinct on (author_id) author_id, title from book order by author_id, published_at desc', stages: 'scan:11 > project:11 > distinct:6 > sort:6' },
  { sql: 'select now() as t, title from book limit 2', stages: 'scan:11 > project:11 > limit:2' },
  { sql: 'select title, price from book order by price desc fetch first 1 row with ties', stages: 'scan:11 > project:11 > sort:11 > limit:1' },
  { sql: 'select title, price from book order by price fetch first 1 row with ties', stages: 'scan:11 > project:11 > sort:11 > limit:2' },
  { sql: 'select price from book order by price limit 5', stages: 'scan:11 > project:11 > sort:11 > limit:5' },
  { sql: 'select title from book order by price limit 1', stages: 'scan:11 > project:11 > sort:11 > limit:1' },
  { sql: 'select title from book order by price limit 4 offset 1', stages: 'scan:11 > project:11 > sort:11 > limit:4' },
  { sql: 'select title from book order by category_id limit 2', stages: 'scan:11 > project:11 > sort:11 > limit:2' },
  { sql: 'select name from employee order by salary limit 2', stages: 'scan:8 > project:8 > sort:8 > limit:2' },
  { sql: 'select name from employee order by salary desc limit 6', stages: 'scan:8 > project:8 > sort:8 > limit:6' },
  { sql: 'select distinct on (category_id) category_id, title from book order by category_id', stages: 'scan:11 > project:11 > distinct:4 > sort:4' },
  { sql: 'select distinct on (city) city, name from customer', stages: 'scan:6 > project:6 > distinct:4' },
  { sql: 'select distinct on (author_id) author_id, title from book', stages: 'scan:11 > project:11 > distinct:6' },
  { sql: 'select distinct city from customer limit 2', stages: 'scan:6 > project:6 > distinct:4 > limit:2' },
  { sql: 'select title from book limit 3 offset 4', stages: 'scan:11 > project:11 > limit:3' },
  { sql: 'select distinct on (price) price, title from book order by price', stages: 'scan:11 > project:11 > distinct:9 > sort:9' },
  { sql: 'select title, upper(title) from book order by upper', stages: 'scan:11 > project:11 > sort:11' },
  { sql: 'select title, title from book order by 1', stages: 'scan:11 > project:11 > sort:11' },
  { sql: "select * from book order by meta->>'lang', title limit 3", stages: 'scan:11 > project:11 > sort:11 > limit:3' },
];
```

`tests/tracer/golden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';
import { GOLDEN } from './golden.queries';

// Каждый запрос: трасса full (значит, сверка с прямым выполнением прошла) и ожидаемые стадии
describe('golden: трасса совпадает с прямым выполнением', () => {
  it.each(GOLDEN)('$sql', ({ sql, stages }) =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(stages);
      }),
    ),
  );
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node tests/tracer/golden.test.ts`. Ожидаемо: `Tests 58 passed (58)`. Упал запрос → это баг пробы или выравнивания, а не повод поменять ожидание: разбирать через superpowers:systematic-debugging, сравнивая `trace.stages.at(-1).output` с `trace.result`.

- [ ] **Шаг 4. Полный прогон:** `pnpm check`. Ожидаемо: typecheck, lint и все тесты зелёные (в эталонном прогоне плана: 15 файлов, 100 тестов в трассировщике).

- [ ] **Шаг 5. Трекер:** P5.15 🔄 → ✅. Фаза Ф5 в шапке трекера ✅, если P5.1-P5.15 ✅. В условии «Готово, когда» запросы уроков главы 4 появятся в Ф8; добавь под фазой строку `Заметка: golden покрывает все конструкции главы 4; запросы самих уроков добавляет Ф8 в tests/tracer/golden.queries.ts.`

- [ ] **Шаг 6. Коммит:**

```bash
pnpm format && pnpm check
git add tests/tracer/golden.queries.ts tests/tracer/golden.test.ts docs/PROGRESS.md
git commit -m "test(tracer): golden-сверка запросов одной таблицы

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Покрытие трекера

- P5.2: задача 1. P5.3: задача 2. P5.4: задача 3. P5.5: задача 6. P5.6: задача 7. P5.7: задача 8. P5.8: задачи 9-10. P5.9: задача 10. P5.10: задача 11. P5.11: задача 4. P5.12: задачи 5-6. P5.13: задача 12. P5.14: задача 13. P5.15: задача 14 (unit-тесты на каждую стадию лежат в задачах 6-13).
- P5.1 (согласование плана) этот план не закрывает.

## Риски и что делать

- **Ничьи и выбор Postgres.** Выравнивание по эталону опирается на канонические значения строк. Если две разные строки дают одинаковые выходные значения, выбор между ними на результат не влияет. Если трасса всё же разошлась, сверка уводит её в `final-only`, неверной анимации не будет.
- **Наследование таблиц (`INHERITS`).** У родителя и потомков ctid могут совпасть, lineage склеит разные строки. В учебных датасетах наследования нет; если появится, добавить в `trace.ts` проверку по `pg_inherits` и `final-only`.
- **`nextval` в превью** двигает последовательность даже после ROLLBACK (проверено). Трассировщик вызывает его дважды (эталон и проба P). Вопрос к Ф2: показывать ли предупреждение.
- **`pg_sleep` и тяжёлые выражения** в пробах не прерываются базой. Их ловит сторож клиента (VS001), трассировка теряется вместе с превью, это ожидаемо.
- **Позиции клауз.** `sourceRange` берётся из `clauseRanges` Ф4 без пересчёта. Тест с алиасом `"Книга"` проверяет, что значения доходят без искажений; перевод байтов в символы делает Ф4.
