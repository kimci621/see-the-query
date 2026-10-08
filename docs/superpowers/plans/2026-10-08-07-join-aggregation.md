# Ф7 «JOIN и агрегация»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используй superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans, чтобы выполнять план задача за задачей. Шаги размечены чекбоксами (`- [ ]`).

**Goal:** `traceStatement` строит стадии `scan × N → join × K → filter → group → filter (having) → project → distinct → sort → limit` для JOIN всех типов (inner, left, right, full, cross, USING, NATURAL, SELF, цепочки 3+) и агрегации с GROUP BY и без. Аниматоры показывают слияние таблиц, NULL-половины, веер CROSS и стопки групп как в спеке 4. Фаззинг трассировщика по bookstore зелёный.

**Architecture:** Всё в рамках пайплайна Ф5: `SELECT_PIPELINE` получает новые шаги `join` (после scan), `group` и `having` (после filter), ядро не переписывается. `SelectCtx` обобщается с одной таблицы на список источников: `flattenFrom` разворачивает левоглубокое дерево FROM в источники и join-узлы, lineage становится кортежем ctid по всем алиасам. Каждая join-стадия - это проба с FROM до k-го JOIN включительно (спека 5.6): у строки без пары ctid несопоставленной стороны равен NULL (проверено в Ф0 для LEFT и FULL, RIGHT симметричен), поэтому пары, клоны и NULL-половины читаются прямо из lineage. Группы - проба `SELECT <ключи>, array_agg(<lineage>), <агрегаты> GROUP BY <ключи>`; строки после group - это группы с ключами `g:N`. Аниматоры Ф7 - чистые функции поверх кадра Ф6, таблица-результат join получает id `t:b|a` (конкатенация алиасов), так цепочка 3+ таблиц работает без спец-логики.

**Tech Stack:** TypeScript strict, `@electric-sql/pglite@0.5.8` (PostgreSQL 18.3), `libpg-query@18.1.5`, `pgsql-deparser@18.3.10` (`deparseSync`, `QuoteUtils`), `@pgsql/types@18`, React 19, `motion@14.0.0`, Vitest 5 (проекты `node` и `dom`), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, разделы 4 («Соединения», «Агрегация»), 5.6, 5.7, 8, 9. Контракты: `docs/superpowers/plans/2026-10-08-00-contracts.md`, разделы 6, 10, 12, 13. План Ф5: `docs/superpowers/plans/2026-10-08-05-tracer-single-table.md` (пайплайн, пробы, выравнивание). План Ф6: `docs/superpowers/plans/2026-10-08-06-overlay-player.md` (кадры, аниматоры, фикстуры, `runUpTo`).

---

## Глобальные ограничения

- Зависимости от других фаз: Ф2 (`DbClient`, `introspect`, `tests/helpers/db.ts`), Ф4 (`initParser`, `parseSql`, `relationsOf`, `clauseRanges`, `deparse`), Ф5 (`SELECT_PIPELINE`, `SelectCtx`, `createProber`, `withSavepoint`, `alignWindow`, `sameResult`, whitelist), Ф6 (`Frame`, `GhostTable`, `ANIMATORS`, `runUpTo`, фикстуры). Ф7 начинается, когда они ✅.
- `features/tracer` не импортирует React. `features/overlay` не ходит в БД, только проигрывает `Trace`.
- Трассировщик вызывается внутри уже открытой транзакции превью. Сам он `BEGIN` / `COMMIT` / `ROLLBACK` не выполняет никогда.
- Целый `SelectStmt` не депарсим (теряется WITH TIES, контракты раздел 1). FROM собирается из фрагментов: `sqlOf(RangeVar)` для источников и `joinFragment` для JOIN-узлов. Эталон выполняется по `stmt.text`.
- Пробы идут под SAVEPOINT с `LIMIT maxRows + 1` на строковых и проверкой `signal` перед каждой (механика Ф5, `probe.ts`). Новые пробы наследуют это автоматически через `ctx.prober`.
- Правые и полные соединения не переставляются в трассировщике: проба выполняется как написано в запросе, NULL-ctid несопоставленной стороны даёт строку «без пары». Зеркальность RIGHT - задача аниматора (задача 6).
- Комментарии в коде на русском, идентификаторы на английском, подписи стадий на русском. Длинное тире в текстах не используем.
- Новых пакетов не ставим.
- Перед каждым коммитом: `pnpm format`, затем `pnpm check` зелёный. Сообщение коммита: `<type>(<area>): <описание на русском>`, последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Коммит идёт с явными путями файлов (не `git add -A`). Трекер `docs/PROGRESS.md` обновляется в том же коммите: пункт ⬜ → 🔄 при старте, 🔄 → ✅ с датой в финальном шаге задачи. Дата подставляется командой `$(date +%F)`.

## Review Focus

1. **RIGHT и FULL JOIN без перестановки в трассировщике.** Проба выполняет `RIGHT JOIN` как написано; у строк, где левая сторона не нашла пару, левый ctid равен NULL (симметрично проверенному в Ф0 LEFT). Трасса хранит алиасы в исходном порядке: `leftAliases` слева, `rightAlias` справа. Аниматор RIGHT зеркалит LEFT в кадре, а не в данных. Проверяется тестами задач 2 и 6: `pairs` содержит `[null, 'b=(0,10)']`, строка результата имеет ключ `a=∅|b=(0,10)`.
2. **USING и NATURAL: слияние колонок-ключей.** В реальном выполнении USING-колонка одна; в стадии join видно обе (сцена до слияния), затем одна. Значение слитой колонки: левая сторона для inner/left/right, `coalesce` для full. NATURAL вычисляет общие колонки по снапшоту схемы; без общих колонок это CROSS. Проверяется тестами задачи 4: 12 колонок в выходе стадии (а не 13), USING по `author_id`.
3. **Пары при клонировании строк.** Одна левая строка с несколькими правыми даёт несколько пар с одним leftKey; RowKey склеен по всем алиасам, поэтому уникален даже при SELF JOIN (одинаковые ctid у двух копий). Клон виден аниматору как several pairs с одним leftKey, бейдж `×N`. Проверяется тестами задач 1 и 5.
4. **Группировка с NULL-ключом.** GROUP BY сводит NULL-ключи в одну группу; `count(*)` считает строки группы, `count(col)` игнорирует NULL-ячейки. Агрегат без GROUP BY возвращает одну строку даже на пустом входе (count = 0). Проверяется тестами задач 8 и 10: группа `author_id IS NULL` из двух книг, `count(*)=11` против `count(price)=10`, `filter:0 > group:1`.
5. **Фаззер как сеть.** Генератор обязан выдавать валидные запросы и давать существенную долю `full` (не вырождаться в `final-only`): порог 80%. Любая трасса с `fallbackReason: 'Сверка с прямым выполнением не сошлась'` - это баг проб, а не особенность запроса. Проверяется тестами задачи 12 с печатью SQL при падении.

## Карта файлов

```
src/features/tracer/
  select/context.ts      SelectCtx на N источников, flattenFrom, fromUpTo        (задачи 1, 4, 8)
  select/scan.ts         scan-стадия для каждого источника                        (задача 1)
  select/join.ts         joinStep: пробы, пары, USING/NATURAL                     (задачи 1, 2, 4)
  select/join.test.ts                                                             (задачи 1, 2, 3, 4)
  select/group.ts        groupStep: группы, члены, агрегаты, ключи g:N            (задачи 8, 9)
  select/group.test.ts                                                            (задачи 8, 9)
  select/pipeline.ts     SELECT_PIPELINE: + join, group, having                   (задачи 1, 8, 9)
  whitelist.ts           фичи join-right / join-full / join-cross / group         (задачи 1, 2, 8)
  captions.ts            подписи join, group, having, агрегата                    (задачи 1, 8, 9)
  trace.ts               multi-source вход, фокус 42803                           (задачи 1, 11)
  select/filter.ts       обобщение пробы на групповой вход (having)               (задача 9)
src/features/overlay/
  __fixtures__/traces.ts joinTrace, leftJoinTrace, crossJoinTrace, groupTrace     (задачи 5, 6, 7, 10)
  animators/join.ts      INNER / LEFT / RIGHT / FULL / CROSS                      (задачи 5, 6, 7)
  animators/join.test.ts                                                         (задачи 5, 6, 7)
  animators/group.ts     GROUP BY и агрегат без GROUP BY                          (задача 10)
  animators/group.test.ts                                                        (задача 10)
  animators/error.ts     подсветка фокусных колонок 42803                        (задача 11)
src/features/errors/dictionary.ts   запись 42803 (если неполная)                 (задача 11)
tests/tracer/golden.queries.ts      golden-запросы Ф7                            (задача 12)
tests/tracer/fuzz-gen.ts            генератор случайных запросов                  (задача 12)
tests/tracer/fuzz.test.ts           фаззинг-сверка                                 (задача 12)
tests/e2e/join-group.spec.ts        сцены JOIN и GROUP BY, скриншоты              (задача 13)
tests/e2e/helpers.ts                общий хелпер открытия страницы                (задача 13, если нет в Ф6)
```

## Проверенные факты, на которых стоит план

- `ctid` несопоставленной стороны равен NULL в LEFT и FULL JOIN - проверено в Ф0 (P0.4, контракты раздел 1). RIGHT симметричен LEFT; тест задачи 2 «RIGHT JOIN» фиксирует это на bookstore. Из этого следует: пары, клоны и строки без пары читаются из lineage без дополнительных проб.
- `ORDER BY` по ctid обязан идти с алиасом таблицы (`order by b.ctid`), иначе сортировка идёт по тексту выхода и `(0,10)` встаёт раньше `(0,2)` (контракты раздел 1). В пробах join сортируем по ctid всех алиасов через запятую.
- `numeric` приходит из PGlite строкой, `date` как `Date` (Ф5, задача 5) - канонизация значений уже есть в `verify.ts`, групповые пробы наследуют её.
- Конкатенация `NULL || x` в SQL даёт NULL всей строки, поэтому lineage в `array_agg` собирается через `coalesce(ctid::text, '∅')` с разделителем.
- `SELECT *` при `JOIN ... USING (c)` выдаёт слитую колонку `c` один раз и первой; проба данных `SELECT b.*, a.*` выдаёт `c` дважды. Сверяется только финальная стадия (проекция из пробы P со звёздочкой в контексте USING), поэтому дубль в join-стадии безвреден: это сцена «до слияния».
- Числа в тестах (9 пар у `book JOIN author`, 2 книги без автора, 1 автор без книг, 66 строк кросса, 6 групп по `author_id`, 15 строк `order_item`) выведены из `content/datasets/bookstore.sql`. Если тест падает на числе - сначала сверь ожидание с прямым выполнением в psql-стиле (`select ...` в PGlite), потом правь тест, а не код под число.
- CROSS JOIN парсится как `JoinExpr` с `jointype: 'JOIN_INNER'` и без `quals` / `usingClause`; запятая в FROM - это `fromClause.length > 1`. Оба случая трактуются как `joinType: 'cross'`; тест задачи 2 фиксирует.

---

## Задача 1. Контекст N источников и стадия join для INNER / LEFT (P7.2, часть P7.3)

`SelectCtx` обобщается с одной таблицы на список источников. `flattenFrom` разворачивает левоглубокое дерево FROM (RangeVar слева, цепочка JoinExpr) в источники и join-узлы; всё, что не RangeVar справа (подзапрос, скобочный JOIN, функция) - причина `final-only` до Ф10. Стадия scan создаётся для каждого источника, стадия join - для каждого join-узла с пробой FROM до этого узла включительно. RIGHT / FULL / CROSS в этой задаче не поддержаны: `whitelist` различает фичи `join-right`, `join-full`, `join-cross`, они добавляются в SUPPORTED в задаче 2.

**Files:**
- Modify: `src/features/tracer/select/context.ts`, `src/features/tracer/select/scan.ts`, `src/features/tracer/select/pipeline.ts`, `src/features/tracer/whitelist.ts`, `src/features/tracer/captions.ts`, `src/features/tracer/trace.ts`, `docs/PROGRESS.md`
- Create: `src/features/tracer/select/join.ts`, `src/features/tracer/select/join.test.ts`

**Interfaces:**
- Consumes: `SelectCtx`, `createProber`, `sqlOf`, `ident`, `typeNames`, `rowKeyOf`, `rangeOf`, `stageId`, `clauseRanges` (Ф4, Ф5).
- Produces:
  - `interface Source { alias: string; tableId: string; table: TableInfo; rv: Node }`;
  - `interface JoinNode { jointype: 'inner' | 'left' | 'right' | 'full' | 'cross'; right: Source; on: Node | null; using: string[] | null; natural: boolean }`;
  - `flattenFrom(sel: SelectStmt, schema: SchemaSnapshot): { ok: true; sources: Source[]; joins: JoinNode[] } | { ok: false; reason: string }`;
  - `joinFragment(j: JoinNode): string` - текст `LEFT JOIN author a ON ...` / `... USING (...)` / `NATURAL JOIN ...` / `CROSS JOIN ...`;
  - SelectCtx: вместо `table` / `alias` - `sources: Source[]`, `joins: JoinNode[]`, `aliasOrder: string[]`; `sql.lineage` - все колонки `b.ctid::text AS __vs_l0, a.ctid::text AS __vs_l1`; `sql.from` - полный FROM; `sql.fromUpTo(k)` - FROM до k-го join включительно; `sql.fromSource(i)` - FROM одного источника;
  - `joinStep: SelectStep` - стадия `join` для каждого узла.

- [ ] **Шаг 1. Трекер:** в `docs/PROGRESS.md` пункт P7.2 ⬜ → 🔄 с датой:

```bash
sed -i '' "s|⬜ \*\*P7\.2\*\*|🔄 ($(date +%F)) **P7.2**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** `src/features/tracer/select/join.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, summary, traceSql } from '../../../../tests/helpers/trace';

describe('стадия join: INNER и LEFT', () => {
  it('INNER JOIN: сканы обеих таблиц, пары, клоны, строки без пары не в результате', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, a.name from book b join author a on b.author_id = a.author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > project:9');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({ joinType: 'inner', leftAliases: ['b'], rightAlias: 'a', onColumns: ['b.author_id', 'a.author_id'], usingColumns: [] });
        expect(join.pairs).toContainEqual(['b=(0,1)', 'a=(0,1)']);
        // Шолохов (a=(0,1)) написал две книги: строка a клонируется на две пары
        expect(join.pairs.filter(([, r]) => r === 'a=(0,1)').map(([l]) => l)).toEqual(['b=(0,1)', 'b=(0,3)']);
        // «Простой Python» и «Изучаем Python» без автора; Пастернак без книг
        expect(join.pairs.every(([, r]) => r !== 'a=(0,6)')).toBe(true);
        expect(trace.result?.rows).toHaveLength(9);
      }),
    ));
  it('LEFT JOIN: строка без пары получает NULL-половину в lineage', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, a.name from book b left join author a on b.author_id = a.author_id');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:11 > project:11');
        const join = stageOf(trace, 'join');
        expect(join.joinType).toBe('left');
        expect(join.pairs).toContainEqual(['b=(0,10)', null]);
        expect(join.pairs).toContainEqual(['b=(0,11)', null]);
        const noPair = join.output.rows.find((r) => r.key === 'b=(0,10)|a=∅');
        expect(noPair?.lineage).toEqual({ b: '(0,10)', a: null });
        expect(noPair?.values).toHaveLength(13); // 9 колонок book + 4 author
      }),
    ));
  it('WHERE после join фильтрует строки уже соединённые', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, "select b.title from book b join author a on b.author_id = a.author_id where a.country = 'Россия'");
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > filter:6 > project:6');
        expect(column(stageOf(trace, 'filter'), 'country')).toEqual(['Россия', 'Россия', 'Россия', 'Россия', 'Россия', 'Россия']);
      }),
    ));
  it('right / full / cross пока честно уходят в final-only', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const right = await traceSql(db, 'select a.name from author a right join book b on a.author_id = b.author_id');
        expect(right).toMatchObject({ mode: 'final-only', fallbackReason: 'Пока не анимируется: RIGHT JOIN' });
        const cross = await traceSql(db, 'select b.title from book b, customer c');
        expect(cross).toMatchObject({ mode: 'final-only', fallbackReason: 'Пока не анимируется: CROSS JOIN' });
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/join.test.ts`. Ожидаемо: `Error: нет стадии join` и `expected 'full' to be 'final-only'` - всё падает.

- [ ] **Шаг 4. Реализация.** `src/features/tracer/select/context.ts` - расширить типы и `createSelectCtx` (сигнатуры из Interfaces; рутина словами):

  - удалить поля `table: TableInfo` и `alias: string`, добавить `sources`, `joins`, `aliasOrder`;
  - `sql.lineage` строить по всем алиасам: `sources.map((s, i) => `${ident(s.alias)}.ctid::text AS __vs_l${i}`).join(', ')`;
  - `sql.fromSource(i)` - ` FROM ${sqlOf(sources[i].rv)}`;
  - `sql.fromUpTo(k)` - ` FROM ${sqlOf(sources[0].rv)}` + `joinFragment` для `joins[0..k]`; `sql.from` = `fromUpTo(joins.length - 1)`;
  - `keyOf` теперь принимает lineage-объект: `rowKeyOf(lineage, ctx.aliasOrder)`;
  - `loadOutputs` и `loadOrdered` не менять по структуре: они уже используют `ctx.sql.from` / `ctx.sql.where` / `ctx.sql.targets`; строка P отдаёт все lineage-колонки, ключ строки - `rowKeyOf` по `aliasOrder`. Аргумент `args.table` заменить на `args.sources` / `args.joins`.

  `flattenFrom` и `joinFragment` - в `select/join.ts` (код ниже). `whitelist.ts`: в `selectFeatures` заменить `if ('JoinExpr' in item) f.add('join')` на разбор jointype (`JOIN_RIGHT` → `join-right`, `JOIN_FULL` → `join-full`, без `quals` и `usingClause` → `join-cross`, иначе `join`), а ветку `fromClause.length > 1` - на `f.add('join-cross')`; в `SUPPORTED` добавить `'join'`; в `FEATURE_LABELS` - подписки `join-right: 'RIGHT JOIN'`, `join-full: 'FULL JOIN'`, `join-cross: 'CROSS JOIN'`. NATURAL остаётся фичей по jointype. `captions.ts`:

```ts
  join: (type: string, pairs: number, noLeft: number, noRight: number) => {
    const parts = [`${type} JOIN: ${pairs} ${plural(pairs, 'пара', 'пары', 'пар')}`];
    if (noLeft) parts.push(`${noLeft} ${plural(noLeft, 'строка', 'строки', 'строк')} слева без пары`);
    if (noRight) parts.push(`${noRight} ${plural(noRight, 'строка', 'строки', 'строк')} справа без пары`);
    return parts.join(', ');
  },
```

  `src/features/tracer/select/scan.ts` - цикл по `ctx.sources` (одна стадия scan на источник, проба `SELECT ${s}.ctid::text AS __vs_l${i}, ${s}.*${ctx.sql.fromSource(i)} ORDER BY ${s}.ctid`, колонки через `ctx.typeNames`, `ctx.scanColumns` накапливаются всеми источниками). `src/features/tracer/select/join.ts`:

```ts
import type { JoinExpr, Node, RangeVar, SelectStmt } from '@pgsql/types';
import type { SchemaSnapshot, TableInfo } from '@/features/db/introspect';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import { rowKeyOf } from '../rowkey';
import type { RowKey } from '../types';
import { findTable } from '../whitelist';
import { rangeOf, stageId } from './context';
import type { SelectCtx, SelectStep } from './pipeline';

export interface Source { alias: string; tableId: string; table: TableInfo; rv: Node }

export interface JoinNode {
  jointype: 'inner' | 'left' | 'right' | 'full' | 'cross';
  right: Source;
  on: Node | null;
  using: string[] | null;
  natural: boolean;
}

// Левоглубокое дерево FROM -> источники и join-узлы по порядку.
// rarg каждого JoinExpr обязан быть RangeVar, иначе мы не умеем (Ф10 возьмёт подзапросы).
export function flattenFrom(sel: SelectStmt, schema: SchemaSnapshot):
  { ok: true; sources: Source[]; joins: JoinNode[] } | { ok: false; reason: string } {
  const sources: Source[] = [];
  const joins: JoinNode[] = [];
  const rvOf = (n: Node): RangeVar | null => ('RangeVar' in n ? n.RangeVar : null);
  const pushSource = (rv: RangeVar): string | null => {
    const table = findTable(schema, rv.schemaname, rv.relname ?? '');
    if (!table) return 'Таблица не найдена в схеме';
    if (table.kind === 'view') return 'Пока не анимируется: представление';
    if (table.kind === 'partitioned') return 'Пока не анимируется: секционированная таблица';
    const alias = rv.alias?.aliasname ?? rv.relname ?? '';
    sources.push({ alias, tableId: table.id, table, rv: { RangeVar: rv } as Node });
    return null;
  };
  const pushJoin = (je: JoinExpr): string | null => {
    if (je.rarg && !rvOf(je.rarg)) return 'Пока не анимируется: сложный FROM (скобки или подзапрос справа от JOIN)';
    const rv = je.rarg ? rvOf(je.rarg) : null;
    if (!rv) return 'Пока не анимируется: сложный FROM';
    const err = pushSource(rv);
    if (err) return err;
    const right = sources[sources.length - 1];
    const using = (je.usingClause ?? null)?.map((n) => ('String' in n ? (n.String.sval ?? '') : '')).filter(Boolean) ?? null;
    const cross = !je.quals && !using && !je.isNatural && je.jointype === 'JOIN_INNER';
    joins.push({
      jointype: cross ? 'cross' : je.jointype === 'JOIN_LEFT' ? 'left' : je.jointype === 'JOIN_FULL' ? 'full' : je.jointype === 'JOIN_RIGHT' ? 'right' : 'inner',
      right,
      on: je.quals ?? null,
      using: using && using.length ? using : null,
      natural: Boolean(je.isNatural),
    });
    return null;
  };
  const walkFrom = (n: Node): string | null => {
    if ('RangeVar' in n) return pushSource(n.RangeVar);
    if ('JoinExpr' in n) {
      const err = walkFrom(n.JoinExpr.larg as Node);
      if (err) return err;
      return pushJoin(n.JoinExpr);
    }
    return 'Пока не анимируется: сложный FROM';
  };
  for (const item of sel.fromClause ?? []) {
    const err = walkFrom(item);
    if (err) return { ok: false, reason: err };
  }
  // запятые: каждый дополнительный элемент FROM - это CROSS JOIN
  return { ok: true, sources, joins };
}

// Текст одного JOIN-узла для сбора FROM до k-го включительно
export function joinFragment(j: JoinNode): string {
  const kw = { inner: 'JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL JOIN', cross: 'CROSS JOIN' }[j.jointype];
  const rel = sqlOf(j.right.rv);
  if (j.jointype === 'cross') return `CROSS JOIN ${rel}`;
  if (j.natural) return `NATURAL ${kw} ${rel}`;
  if (j.using) return `${kw} ${rel} USING (${j.using.map(ident).join(', ')})`;
  return `${kw} ${rel} ON ${j.on ? sqlOf(j.on) : 'TRUE'}`;
}

// JOIN: по одному на узел. Проба с FROM до k-го JOIN включительно, пары из lineage
export const joinStep: SelectStep = {
  name: 'join',
  applies: (ctx) => ctx.joins.length > 0,
  async run(ctx) {
    for (const [k, j] of ctx.joins.entries()) {
      const count = k + 2; // источников в этой пробе
      const aliases = ctx.aliasOrder.slice(0, count);
      const lineageSql = aliases.map((a) => `${ident(a)}.ctid::text`).join(', ');
      const colsSql = aliases.map((a) => `${ident(a)}.*`).join(', ');
      const orderSql = aliases.map((a) => `${ident(a)}.ctid`).join(', ');
      const r = await ctx.prober.rows(`SELECT ${lineageSql}, ${colsSql}${ctx.sql.fromUpTo(k)} ORDER BY ${orderSql}`);
      const types = await ctx.typeNames(r.fields.slice(aliases.length).map((f) => f.dataTypeID));
      const leftAliases = ctx.aliasOrder.slice(0, count - 1);
      const pairs: Array<[RowKey | null, RowKey | null]> = [];
      const rows = r.rows.map((row) => {
        const lineage: Record<string, string | null> = {};
        aliases.forEach((a, i) => { lineage[a] = (row[i] as string | null) ?? null; });
        const leftCtids = leftAliases.map((a) => lineage[a]);
        const leftKey = leftCtids.some((c) => c === null) ? null : rowKeyOf(lineage, leftAliases);
        const rightKey = lineage[j.right.alias] === null ? null : `${j.right.alias}=${lineage[j.right.alias]}`;
        pairs.push([leftKey, rightKey]);
        return { key: rowKeyOf(lineage, aliases), lineage, values: row.slice(aliases.length) };
      });
      ctx.columns = r.fields.slice(aliases.length).map((f, i) => ({
        name: f.name,
        type: types.get(f.dataTypeID) ?? 'unknown',
        source: { alias: aliases[Math.floor(i / Math.max(1, ctx.columnsOf(k + 1) - 0)) % aliases.length] ?? '', column: f.name }, // см. ниже
      }));
      ctx.rows = rows;
      const noLeft = pairs.filter(([l]) => l === null).length;
      const noRight = pairs.filter(([, rr]) => rr === null).length;
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
        caption: captions.join(j.jointype === 'inner' ? 'INNER' : j.jointype.toUpperCase(), pairs.length, noLeft, noRight),
        output: { columns: ctx.columns, rows: ctx.rows },
      });
    }
  },
};

// Квалифицированные 'alias.column' из ON-условия, в порядке вхождения (пары левая-правая)
function onColumnNames(j: JoinNode): string[] {
  if (!j.on) return [];
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object') {
      for (const [key, value] of Object.entries(n)) {
        if (key === 'ColumnRef') {
          const parts = ((value as { fields?: Node[] }).fields ?? []).flatMap((f) => ('String' in f ? [f.String.sval ?? ''] : []));
          if (parts.length) out.push(parts.join('.'));
        }
        walk(value);
      }
    }
  };
  walk(j.on);
  return out;
}
```

  Пояснение к `ctx.columns` (в коде выше упрощено - реализовать нормально): колонки пробы принадлежат источникам по порядку, `fields.slice(aliases.length)` - это `b.*, a.*`, поэтому source для i-й колонки: алиас `sources[floor(i / длина_колонок_источника)]`. Проще: собрать по источникам из `ctx.sources[i]` (каждому источнику заранее известны его колонки из scan-стадии). `ctx.columnsOf` в черновике - не вводить, взять `ctx.sourceColumns(i)` - список `Column` источника i, собранный scan-шагом.

  `pipeline.ts`: `export const SELECT_PIPELINE: SelectStep[] = [scanStep, joinStep, filterStep, projectStep, distinctStep, sortStep, limitStep];`. `trace.ts`: ветка с `createSelectCtx(args)` - вместо разбора первого `RangeVar` вызвать `flattenFrom`; `ok: false` → `finalOnly(reason)`; `args` получает `sources` / `joins` / `aliasOrder`; ветка SELECT без FROM не меняется.

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 4 passed (4)`. Затем вся папка: `pnpm vitest run --project node src/features/tracer` - тесты Ф5 зелёные (обобщение не сломало одну таблицу: `sources.length === 1`, `joins.length === 0`).

- [ ] **Шаг 6. Трекер:** P7.2 🔄 → ✅ (частично P7.3 - inner/left готовы):

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.2\*\*|✅ ($(date +%F)) **P7.2**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/context.ts src/features/tracer/select/scan.ts src/features/tracer/select/join.ts src/features/tracer/select/join.test.ts src/features/tracer/select/pipeline.ts src/features/tracer/whitelist.ts src/features/tracer/captions.ts src/features/tracer/trace.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия join для INNER и LEFT с парами и клонами

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 2. RIGHT, FULL и CROSS (P7.3)

Перестановки нет: проба выполняет `RIGHT JOIN` / `FULL JOIN` как написано, NULL-ctid несопоставленной стороны даёт строку без пары. `pairs` для RIGHT содержит `[null, rightKey]`, для FULL - и `[left, null]`, и `[null, right]`. CROSS: все комбинации, `onColumns` пуст, `pairs` покрывают всю сетку. Whitelist открывает фичи `join-right`, `join-full`, `join-cross`.

**Files:**
- Modify: `src/features/tracer/select/join.ts`, `src/features/tracer/select/join.test.ts`, `src/features/tracer/whitelist.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `joinStep`, `joinFragment`, `flattenFrom` (задача 1).
- Produces: поддержка `jointype` right / full / cross в `joinStep`; `SUPPORTED` += `'join-right'`, `'join-full'`, `'join-cross'`.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.3\*\*|🔄 ($(date +%F)) **P7.3**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** - дописать в `src/features/tracer/select/join.test.ts` в `describe`:

```ts
  it('RIGHT JOIN: у строки без пары слева NULL-ctid, пара [null, right]', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select a.name, b.title from author a right join book b on a.author_id = b.author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:6 > scan:11 > join:11 > project:11');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({ joinType: 'right', leftAliases: ['a'], rightAlias: 'b' });
        // две книги без автора: левая половина NULL
        expect(join.pairs).toContainEqual([null, 'b=(0,10)']);
        expect(join.pairs).toContainEqual([null, 'b=(0,11)']);
        const noPair = join.output.rows.find((r) => r.key === 'a=∅|b=(0,10)');
        expect(noPair?.lineage).toEqual({ a: null, b: '(0,10)' });
      }),
    ));
  it('FULL JOIN: NULL с обеих сторон, 12 строк', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, a.name from book b full join author a on b.author_id = a.author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:12 > project:12');
        const join = stageOf(trace, 'join');
        expect(join.joinType).toBe('full');
        expect(join.pairs).toContainEqual(['b=(0,10)', null]);
        expect(join.pairs).toContainEqual([null, 'a=(0,6)']); // Пастернак без книг
        expect(join.output.rows.find((r) => r.key === '∅|a=(0,6)')?.values.slice(9)).toEqual([null, 'Борис Пастернак', 'Россия', 1890]);
      }),
    ));
  it('CROSS JOIN: сетка всех пар', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, c.name from book b cross join customer c');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:66 > project:66');
        const join = stageOf(trace, 'join');
        expect(join).toMatchObject({ joinType: 'cross', onColumns: [], usingColumns: [] });
        expect(join.pairs).toHaveLength(66);
        expect(new Set(join.pairs.map(([l]) => l)).size).toBe(11); // каждый left ровно 6 раз
        expect(join.pairs).toContainEqual(['b=(0,1)', 'c=(0,1)']);
      }),
    ));
  it('запятая в FROM - это CROSS JOIN', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, c.name from book b, customer c');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:66 > project:66');
        expect(stageOf(trace, 'join').joinType).toBe('cross');
      }),
    ));
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/join.test.ts`. Ожидаемо: новые 4 теста падают (`Пока не анимируется: RIGHT JOIN` / `FULL JOIN` / `CROSS JOIN` - фичи ещё не в SUPPORTED).

- [ ] **Шаг 4. Реализация.** `whitelist.ts`: в `SUPPORTED` добавить `'join-right'`, `'join-full'`, `'join-cross'`. `join.ts`: код задачи 1 уже обрабатывает все jointype одинаково (пары из lineage, NULL-ctid даёт null-половину), поэтому основная правка - подпись: для right/full/cross `captions.join` получает правильный тип ('RIGHT' / 'FULL' / 'CROSS'), а для CROSS заменить подпись на `CROSS JOIN: 11 × 6 = 66`:

```ts
      const caption = j.jointype === 'cross'
        ? `CROSS JOIN: ${ctx.rowsBefore(k)} × ${rowsOfSource(k + 1)} = ${pairs.length}`
        : captions.join(...); // как в задаче 1
```

  где `rowsBefore(k)` - число строк левой стороны (последняя join- или scan-стадия), `rowsOfSource(i)` - из scan-стадии источника i. Если тест FULL падает на порядке колонок у строки `∅|a=(0,6)` - сверить с эталоном: `values` идут в порядке `b.*, a.*`, левые все NULL.

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 8 passed (8)`.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.3\*\*|✅ ($(date +%F)) **P7.3**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/join.ts src/features/tracer/select/join.test.ts src/features/tracer/whitelist.ts docs/PROGRESS.md
git commit -m "feat(tracer): RIGHT, FULL и CROSS JOIN без перестановки сторон

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 3. Цепочка 3+ таблиц и SELF JOIN (P7.4, P7.5)

Механика многосоединений уже есть из задач 1-2 (левоглубокое дерево разворачивается, каждый узел - отдельная join-стадия, leftKey составной). Здесь закрываем крайние случаи: составные leftKeys, одинаковые имена колонок у разных источников (`e.name` / `m.name`), две scan-стадии одной таблицы с разными алиасами, join-проба с ORDER BY по нескольким ctid.

**Files:**
- Modify: `src/features/tracer/select/join.test.ts`, `src/features/tracer/select/join.ts` (мелкие фиксы по итогам), `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `joinStep` целиком.
- Produces: гарантируется `pairs[i][0]` формата `o=(0,1)|oi=(0,1)` для второго и следующих join; колонки источника `Column.source.alias` корректен при дубликатах имён.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.4\*\*|🔄 ($(date +%F)) **P7.4**|" docs/PROGRESS.md
sed -i '' "s|⬜ \*\*P7\.5\*\*|🔄 ($(date +%F)) **P7.5**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** - дописать в `src/features/tracer/select/join.test.ts`:

```ts
  it('цепочка из 4 таблиц: три join-стадии с промежуточными результатами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db,
          'select b.title, c.name, o.order_id from orders o join order_item oi on o.order_id = oi.order_id join book b on oi.book_id = b.book_id join customer c on o.customer_id = c.customer_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:8 > scan:15 > scan:11 > scan:6 > join:15 > join:15 > join:15 > project:15');
        const joins = trace.stages.filter((s) => s.kind === 'join');
        expect(joins.map((j) => (j as Extract<typeof j, { kind: 'join' }>).leftAliases)).toEqual([['o'], ['o', 'oi'], ['o', 'oi', 'b']]);
        expect(joins[1].pairs[0][0]).toMatch(/^o=\(0,\d+\)\|oi=\(0,\d+\)$/);
        // каждая order_item строка дошла до конца
        expect(trace.result?.rows).toHaveLength(15);
      }),
    ));
  it('SELF JOIN: две копии employee, ключи строк различаются алиасами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select e.name, m.name from employee e join employee m on e.manager_id = m.employee_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:8 > scan:8 > join:7 > project:7');
        const join = stageOf(trace, 'join');
        expect(join.onColumns).toEqual(['e.manager_id', 'm.employee_id']);
        // Орлов: менеджер Николаева
        expect(join.pairs).toContainEqual(['e=(0,2)', 'm=(0,1)']);
        expect(join.output.rows.find((r) => r.key === 'e=(0,2)|m=(0,1)')?.values[3]).toBe(1); // e.manager_id
        // две scan-стадии одной таблицы
        expect(trace.stages.filter((s) => s.kind === 'scan').map((s) => (s as Extract<typeof s, { kind: 'scan' }>).alias)).toEqual(['e', 'm']);
      }),
    ));
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/join.test.ts`. Ожидаемо: два новых теста падают. Если падают на числах - сверить ожидания с прямым выполнением; если на `leftAliases` - баг flatten, смотреть порядок walkFrom.

- [ ] **Шаг 4. Реализация.** Ожидаемо, что тесты почти проходят: задача 1 уже обрабатывает цепочки. Возможные реальные фиксы в `join.ts` / `context.ts`:
  - колонки источника: `Column.source` должен указывать на алиас своего источника, а не «последнего» (дубль `name` у `e` и `m`, `order_id` у `o` и `oi`); собрать по источникам из scan-стадий;
  - `SELECT b.*, a.*` с одинаковыми именами: `probe.fields` отдаёт дубликаты имён - в `Relation.columns` это допустимо, различает их `source.alias` (рендер различает через `columnKeys` Ф6);
  - проба join: `ORDER BY o.ctid, oi.ctid, b.ctid` уже собирается из списка алиасов - проверить, что для right-join в цепочке NULL-ctid не ломает сортировку (Postgres ставит NULLS LAST, порядок внутри пар стабилен).

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 10 passed (10)`.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.4\*\*|✅ ($(date +%F)) **P7.4**|" docs/PROGRESS.md
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.5\*\*|✅ ($(date +%F)) **P7.5**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/join.ts src/features/tracer/select/join.test.ts docs/PROGRESS.md
git commit -m "feat(tracer): цепочки 3+ таблиц и SELF JOIN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 4. USING и NATURAL: слияние колонок-ключей (P7.6)

В реальном выполнении USING-колонка одна; в стадии join видим обе (сцена «до слияния»), затем в output стадии правый дубль исключён: колонок `9 + 4 - 1 = 12`. Значение слитой колонки: левая сторона для inner/left/right, `coalesce` обеих для full (значения обоих есть в пробе `b.*, a.*`). NATURAL: общие колонки вычисляются по снапшоту схемы (пересечение имён колонок сторон); NATURAL с right/full даёт `join-right` / `join-full` по jointype. NATURAL без общих колонок - это CROSS (спека: так ведёт себя Postgres).

**Files:**
- Modify: `src/features/tracer/select/join.ts`, `src/features/tracer/select/join.test.ts`, `src/features/tracer/whitelist.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `JoinNode`, `joinStep`, `flattenFrom`, `findTable`, снапшот схемы в `ctx`.
- Produces: `resolveUsing(ctx, k): string[]` - фактические имена слитых колонок (из `j.using` или пересечения колонок сторон для NATURAL); в стадии join: `usingColumns` = этот список, правые using-колонки исключены из `output.columns` / `values`; caption упоминает NATURAL.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.6\*\*|🔄 ($(date +%F)) **P7.6**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** - дописать в `src/features/tracer/select/join.test.ts`:

```ts
  it('USING: колонка-ключ слилась, в выходе 12 колонок, пары по ключу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select * from book b join author a using (author_id)');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const join = stageOf(trace, 'join');
        expect(join.usingColumns).toEqual(['author_id']);
        expect(join.onColumns).toEqual([]);
        expect(join.output.columns.map((c) => c.name)).toEqual([
          'book_id', 'title', 'author_id', 'category_id', 'price', 'pages', 'published_at', 'tags', 'meta',
          'name', 'country', 'born_year',
        ]);
        expect(join.pairs).toContainEqual(['b=(0,1)', 'a=(0,1)']);
        expect(trace.result?.rows).toHaveLength(9);
        // эталон: слитая author_id от Postgres (первая колонка)
        expect(trace.result?.fields.map((f) => f.name).slice(0, 3)).toEqual(['author_id', 'book_id', 'title']);
      }),
    ));
  it('NATURAL JOIN: общие колонки по схеме, здесь author_id', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, a.name from book b natural join author a');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > project:9');
        const join = stageOf(trace, 'join');
        expect(join.usingColumns).toEqual(['author_id']);
        expect(join.caption).toContain('NATURAL');
      }),
    ));
  it('NATURAL без общих колонок - это CROSS JOIN', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title, c.name from book b natural join customer c');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:66 > project:66');
        expect(stageOf(trace, 'join')).toMatchObject({ joinType: 'cross', usingColumns: [] });
      }),
    ));
  it('FULL JOIN USING: слитая колонка = coalesce сторон', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select * from book b full join author a using (author_id)');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const join = stageOf(trace, 'join');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:12 > project:12');
        // автор без книг: слитая колонка из правой половины
        const orphan = join.output.rows.find((r) => r.key === '∅|a=(0,6)');
        expect(orphan?.values[2]).toBe(6);
      }),
    ));
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/join.test.ts`. Ожидаемо: 4 новых теста падают (в выходе 13 колонок, `usingColumns` пуст, NATURAL уходит в final-only из-за отсутствия using в пробе).

- [ ] **Шаг 4. Реализация** - в `src/features/tracer/select/join.ts`:

```ts
// Фактические слитые колонки: USING - из AST, NATURAL - пересечение имён колонок сторон по схеме
function resolveUsing(ctx: SelectCtx, k: number, j: JoinNode): string[] {
  if (j.using) return j.using;
  if (!j.natural) return [];
  const rightNames = new Set(j.right.table.columns.map((c) => c.name));
  const leftNames = new Set<string>();
  for (const s of ctx.sources.slice(0, k + 1)) for (const c of s.table.columns) leftNames.add(c.name);
  return [...leftNames].filter((n) => rightNames.has(n)).sort();
}
```

  В `joinStep.run` после пробы:
  - `const using = resolveUsing(ctx, k, j)`; если `j.natural` и `using.length === 0` - узел обрабатывается как cross (и `joinFragment` уже пишет `NATURAL JOIN`, Postgres выполнит как cross);
  - из `r.fields` (и значений строк) выбросить колонки правой стороны с именами из `using`: индексы `fields.slice(aliases.length)` соответствуют `b.*, a.*` - правые using-колонки получают индексы `leftCols + позиция в a.*`; выкинуть их из `columns` и `values`;
  - слитая колонка: значение левой, при `jointype === 'full'` - `coalesce`: если левое null, взять правое (обе половины есть в пробе до выброса);
  - `usingColumns: using`; `pairs` по-прежнему из lineage (ctid у USING-пар полный, у left/full без пары - null);
  - caption: `j.natural ? \`NATURAL JOIN: общие колонки ${using.join(', ')}\` : \`JOIN ... USING (${using.join(', ')})\``.

  `whitelist.ts`: NATURAL больше не блокируется отдельной фичей - jointype решает; в `flattenFrom` NATURAL при отсутствии общих колонок превращается в cross (фича `join-cross`).

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 14 passed (14)`. Если FULL USING падает на порядке колонок эталона - сверить `trace.result.fields` (Postgres ставит слитые using-колонки первыми) с нашими колонками project: они из пробы P со звёздочкой, порядок совпадает автоматически.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.6\*\*|✅ ($(date +%F)) **P7.6**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/join.ts src/features/tracer/select/join.test.ts src/features/tracer/whitelist.ts docs/PROGRESS.md
git commit -m "feat(tracer): USING и NATURAL со слиянием колонок-ключей

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 5. Аниматор INNER JOIN (P7.7)

Чистая функция поверх кадра Ф6. Таблицы сторон находятся по id: левая `t:${leftAliases.join('|')}`, правая `t:${rightAlias}` (scan-аниматор Ф6 кладёт их в рабочую зону). Результат получает id `t:${[...leftAliases, rightAlias].join('|')}` - конвенция, на которую опираются следующие join-узлы и все стадии после (currentTable = результат, он добавлен последним). Фазы: сближение → линии пар между ячейками ключей → отсев непарных → слияние в таблицу-результат. Клонирование: левая строка с несколькими парами помечается бейджем `×N`.

**Files:**
- Modify: `src/features/overlay/__fixtures__/traces.ts`, `docs/PROGRESS.md`
- Create: `src/features/overlay/animators/join.ts`, `src/features/overlay/animators/join.test.ts`

**Interfaces:**
- Consumes: `Animator`, `Frame`, `GhostTable`, `Decoration`, `StageOf`, `runUpTo`, `rebuildTable`, `withTable`, `mapRows`, `ghostRows`, `cellCenter`, `ghostWidth`, `TABLE_GAP`, `testCtx` (Ф6).
- Produces: `joinAnimator: Animator<StageOf<'join'>>` (ветки left/right/full/cross добавляются задачами 6-7, до них - `genericAnimator`), `joinTableId(aliases: string[]): string`.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.7\*\*|🔄 ($(date +%F)) **P7.7**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Фикстуры** - дописать в `src/features/overlay/__fixtures__/traces.ts`:

```ts
// select b.title, a.name from book b join author a on b.author_id = a.author_id (сокращённо до 4 книг и 3 авторов)
const bCols = [
  { name: 'book_id', type: 'bigint', source: { alias: 'b', column: 'book_id' } },
  { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
  { name: 'author_id', type: 'bigint', source: { alias: 'b', column: 'author_id' } },
];
const aCols = [
  { name: 'author_id', type: 'bigint', source: { alias: 'a', column: 'author_id' } },
  { name: 'name', type: 'text', source: { alias: 'a', column: 'name' } },
];
const bRow = (ctid: string, id: number, title: string, author: number | null): Row => ({ key: `b=${ctid}`, lineage: { b: ctid }, values: [id, title, author] });
const aRow = (ctid: string, id: number, name: string): Row => ({ key: `a=${ctid}`, lineage: { a: ctid }, values: [id, name] });
const BOOKS2 = [bRow('(0,1)', 1, 'Тихий Дон', 1), bRow('(0,3)', 3, 'Судьба человека', 1), bRow('(0,4)', 4, 'Капитанская дочка', 3), bRow('(0,10)', 10, 'Простой Python', null)];
const AUTHORS = [aRow('(0,1)', 1, 'Михаил Шолохов'), aRow('(0,3)', 3, 'Александр Пушкин'), aRow('(0,6)', 6, 'Борис Пастернак')];

export function joinTrace(): Trace {
  const joinOut = {
    columns: [...bCols, ...aCols],
    rows: [
      { key: 'b=(0,1)|a=(0,1)', lineage: { b: '(0,1)', a: '(0,1)' }, values: [1, 'Тихий Дон', 1, 1, 'Михаил Шолохов'] },
      { key: 'b=(0,3)|a=(0,1)', lineage: { b: '(0,3)', a: '(0,1)' }, values: [3, 'Судьба человека', 1, 1, 'Михаил Шолохов'] },
      { key: 'b=(0,4)|a=(0,3)', lineage: { b: '(0,4)', a: '(0,3)' }, values: [4, 'Капитанская дочка', 3, 3, 'Александр Пушкин'] },
    ],
  };
  const stages: Stage[] = [
    { id: 's0', kind: 'scan', alias: 'b', tableId: 'public.book', caption: 'FROM book: 4 строки', output: { columns: bCols, rows: BOOKS2 } },
    { id: 's1', kind: 'scan', alias: 'a', tableId: 'public.author', caption: 'FROM author: 3 строки', output: { columns: aCols, rows: AUTHORS } },
    {
      id: 's2', kind: 'join', joinType: 'inner', leftAliases: ['b'], rightAlias: 'a',
      pairs: [['b=(0,1)', 'a=(0,1)'], ['b=(0,3)', 'a=(0,1)'], ['b=(0,4)', 'a=(0,3)']],
      onColumns: ['b.author_id', 'a.author_id'], usingColumns: [],
      caption: 'INNER JOIN: 3 пары, 1 строка слева без пары, 1 справа', output: joinOut,
    },
    { id: 's3', kind: 'project', kept: ['title', 'name'], removed: ['book_id', 'author_id'], computed: [], renamed: {}, caption: 'SELECT', output: joinOut },
  ];
  return {
    sql: 'select b.title, a.name from book b join author a on b.author_id = a.author_id',
    statementType: 'select', mode: 'full', touched: { tableIds: ['public.book', 'public.author'], columns: [] },
    stages, result: null, error: null, notices: [], timingMs: 10,
  };
}

// то же, но LEFT: «Простой Python» без пары, pairs содержит ['b=(0,10)', null]
export function leftJoinTrace(): Trace { /* как joinTrace, но joinType: 'left', pairs + ['b=(0,10)', null], output.rows + строка b=(0,10)|a=∅ со значениями [10, 'Простой Python', null, null, null] */ }
```

- [ ] **Шаг 3. Падающие тесты** `src/features/overlay/animators/join.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { joinTrace, testCtx } from '../__fixtures__/traces';
import { runUpTo } from '../__fixtures__/runUpTo';
import { joinAnimator } from './join';

describe('joinAnimator: INNER', () => {
  const trace = joinTrace();
  const stage = trace.stages[2] as Extract<Stage, { kind: 'join' }>;
  const before = runUpTo(trace, 2, testCtx());
  const phases = joinAnimator(before, stage, 2, testCtx());

  it('четыре фазы: сближение, линии, отсев, слияние', () => {
    expect(phases.map((p) => p.id)).toEqual(['2:approach', '2:lines', '2:unmatched', '2:merge']);
    expect(phases.every((p) => p.stageIndex === 2)).toBe(true);
    expect(phases.every((p) => p.durationMs >= 400 && p.durationMs <= 900)).toBe(true);
  });
  it('сближение: таблицы съехались, зазор между ними', () => {
    const t = phases[0].frame.tables;
    const [left, right] = t;
    expect(right.x).toBeGreaterThan(left.x + 3 * 132);
    expect(right.x).toBeLessThan(before.tables[1].x);
  });
  it('линии пар между ячейками ключей', () => {
    const lines = phases[1].frame.decorations.filter((d) => d.kind === 'pair-line');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ from: { table: 't:b', row: 'b=(0,1)', col: 'author_id' }, to: { table: 't:a', row: 'a=(0,1)', col: 'author_id' } });
  });
  it('непарные строки краснеют с обеих сторон', () => {
    const tables = phases[2].frame.tables;
    const b = tables.find((t) => t.id === 't:b');
    const a = tables.find((t) => t.id === 't:a');
    expect(b?.rows.find((r) => r.key === 'b=(0,10)')?.state).toBe('dropped');
    expect(a?.rows.find((r) => r.key === 'a=(0,6)')?.state).toBe('dropped');
    expect(b?.rows.find((r) => r.key === 'b=(0,1)')?.state).toBe('normal');
  });
  it('слияние: одна таблица-результат, ключи строк склеены, клон с бейджем', () => {
    const t = phases[3].frame.tables;
    expect(t.map((x) => x.id)).toEqual(['t:b|a']);
    const rows = t[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)|a=(0,1)', 'b=(0,3)|a=(0,1)', 'b=(0,4)|a=(0,3)']);
    // правая строка a=(0,1) встречается в двух парах - бейдж ×2
    expect(rows.find((r) => r.key === 'b=(0,1)|a=(0,1)')?.badge).toBe('×2');
    expect(phases[3].caption).toBe(stage.caption);
  });
  it('пустой кадр не ломает аниматор', () => {
    const p = joinAnimator({ tables: [], decorations: [] }, stage, 2, testCtx());
    expect(p[p.length - 1].frame.tables[0].rows).toHaveLength(3);
  });
});
```

- [ ] **Шаг 4. Запуск:** `pnpm vitest run --project node src/features/overlay/animators/join.test.ts`. Ожидаемо: `Cannot find module './join'`.

- [ ] **Шаг 5. Реализация** `src/features/overlay/animators/join.ts`:

```ts
import { cellCenter, ghostWidth, TABLE_GAP } from '../geometry';
import { clearMarks, counterNear, mapRows, rebuildTable, withTable } from '../frame';
import { tableTitle } from '../labels';
import type { RowKey } from '@/features/tracer/types';
import type { Animator, Frame, GhostRow, StageOf } from '../types';
import { genericAnimator } from './generic';
import { crossPhases } from './cross'; // задача 7; до неё - заглушка в этом же файле

export const joinTableId = (aliases: string[]) => `t:${aliases.join('|')}`;

// INNER / LEFT / RIGHT / FULL JOIN: сближение, линии пар, отсев, слияние
export const joinAnimator: Animator<StageOf<'join'>> = (prev, stage, stageIndex, ctx) => {
  if (stage.joinType === 'cross') return crossPhases(prev, stage, stageIndex, ctx);
  const leftId = joinTableId(stage.leftAliases);
  const rightId = `t:${stage.rightAlias}`;
  const left = prev.tables.find((t) => t.id === leftId) ?? prev.tables.at(-1);
  const right = prev.tables.find((t) => t.id === rightId);
  if (!left || !right) return genericAnimator(prev, stage, stageIndex, ctx);

  // 1. сближение: левая остаётся, правая подъезжает вплотную
  const approachRight = { ...clearMarks(right), x: left.x + ghostWidth(left) + TABLE_GAP, y: left.y };
  const approach = { tables: prev.tables.map((t) => (t.id === rightId ? approachRight : t)), decorations: [] };

  // 2. линии пар между ячейками ключей (onColumns / usingColumns)
  const paired = new Set(stage.pairs.flatMap(([l, r]) => [l, r]).filter(Boolean) as RowKey[]);
  const lines = stage.pairs
    .filter(([l, r]) => l !== null && r !== null)
    .map(([l, r], i) => {
      const [lc, rc] = keyColumns(stage, left, right);
      return {
        kind: 'pair-line' as const, id: `${stageIndex}:pair${i}`,
        from: { table: leftId, row: l, col: lc }, to: { table: rightId, row: r, col: rc },
      };
    });
  const linesFrame = { tables: approach.tables, decorations: lines };

  // 3. непарные краснеют и уходят
  const dropped = (t: typeof left) => mapRows(clearMarks(t), (r) => (paired.has(r.key) ? {} : { state: 'dropped' as const }));
  const unmatched = { tables: approach.tables.map((t) => (t.id === leftId ? dropped(left) : t.id === rightId ? dropped(right) : t)), decorations: lines };

  // 4. слияние: таблица-результат на месте стыка, строки выхода стадии
  const result = rebuildTable(
    { id: joinTableId([...stage.leftAliases, stage.rightAlias]), title: stage.leftAliases.concat(stage.rightAlias).map(tableTitleOf).join(' + '), x: left.x, y: left.y },
    stage.output,
  );
  const cloneCount = new Map<RowKey, number>();
  for (const [l] of stage.pairs) if (l) cloneCount.set(l, (cloneCount.get(l) ?? 0) + 1);
  const merged: GhostRow[] = result.rows.map((r) => {
    const rightKey = r.key.split('|').at(-1) ?? '';
    const n = stage.pairs.filter(([, rr]) => rr !== null && `a=${rr}`.length > 0 && rr === rightKey.replace('a=', '')).length;
    return n > 1 ? { ...r, badge: `×${n}` } : r;
  });
  const mergedTable = { ...result, rows: merged };
  const mergeFrame = {
    tables: prev.tables.filter((t) => t.id !== leftId && t.id !== rightId).concat(mergedTable),
    decorations: [counterNear(mergedTable, `${stageIndex}:counter`, `${stage.pairs.length} пар`)],
  };

  return [
    { id: `${stageIndex}:approach`, stageIndex, caption: `${joinLabel(stage)}: таблицы съезжаются`, durationMs: 700, frame: approach },
    { id: `${stageIndex}:lines`, stageIndex, caption: `${joinLabel(stage)}: совпавшие строки соединены линиями`, durationMs: 700, frame: linesFrame },
    { id: `${stageIndex}:unmatched`, stageIndex, caption: `${joinLabel(stage)}: строки без пары уходят`, durationMs: 600, frame: unmatched },
    { id: `${stageIndex}:merge`, stageIndex, caption: stage.caption, durationMs: 700, frame: mergeFrame },
  ];
};

const joinLabel = (s: StageOf<'join'>) => (s.joinType === 'inner' ? 'INNER JOIN' : `${s.joinType.toUpperCase()} JOIN`);
const tableTitleOf = (alias: string) => alias; // имя таблицы по алиасу не нужно: заголовок из алиасов

// Колонки ключей для линий: onColumns 'alias.col' (левая, правая), для USING - имя из usingColumns
function keyColumns(stage: StageOf<'join'>, left: Frame['tables'][number], right: Frame['tables'][number]): [string, string] {
  if (stage.usingColumns.length) return [stage.usingColumns[0], stage.usingColumns[0]];
  const qualified = stage.onColumns.map((c) => c.split('.'));
  const leftCol = qualified.find(([a]) => stage.leftAliases.includes(a))?.[1];
  const rightCol = qualified.find(([a]) => a === stage.rightAlias)?.[1];
  return [leftCol ?? left.columns.at(-1)?.name ?? '', rightCol ?? right.columns.at(-1)?.name ?? ''];
}
```

  Пояснение к подсчёту клонов (упрощено в черновике): бейдж `×N` считается по повторению rightKey среди пар - «строка a встречается в N парах». Реализовать честно: `const n = stage.pairs.filter(([, rr]) => rr === rightKey).length`, где rightKey - правая часть ключа строки результата (после `|`). Для LEFT бейдж ставится только у строк с парой.

- [ ] **Шаг 6. Запуск:** та же команда. Ожидаемо: `Tests 6 passed (6)`.

- [ ] **Шаг 7. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.7\*\*|✅ ($(date +%F)) **P7.7**|" docs/PROGRESS.md
```

- [ ] **Шаг 8. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/overlay/__fixtures__/traces.ts src/features/overlay/animators/join.ts src/features/overlay/animators/join.test.ts docs/PROGRESS.md
git commit -m "feat(overlay): аниматор INNER JOIN с линиями пар и клонами

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 6. Аниматоры LEFT / RIGHT / FULL: NULL-половины (P7.8)

LEFT: левая строка без пары не уходит - едет в результат, правая половина заполнена NULL-плашками (`state: 'null-filled'`, значения null). Правые без пары краснеют. RIGHT зеркально: правая строка без пары остаётся с NULL-левой половиной, таблицы подходят «справа налево». FULL: обе стороны без пар остаются. В трассировщике перестановки нет (задача 2), зеркалит только кадр.

**Files:**
- Modify: `src/features/overlay/animators/join.ts`, `src/features/overlay/animators/join.test.ts`, `src/features/overlay/__fixtures__/traces.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `joinAnimator`, фикстура `leftJoinTrace` (задача 5).
- Produces: ветки left / right / full в `joinAnimator`: строки `null-filled`, NULL-плашки в значениях (рендер Ф6 рисует NULL по `formatValue`), зеркальная раскладка для right.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.8\*\*|🔄 ($(date +%F)) **P7\.8**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** - дописать в `src/features/overlay/animators/join.test.ts`:

```ts
describe('joinAnimator: LEFT / RIGHT / FULL', () => {
  it('LEFT: строка без пары остаётся с NULL-половиной, правые без пары уходят', () => {
    const trace = leftJoinTrace();
    const stage = trace.stages[2] as Extract<Stage, { kind: 'join' }>;
    const phases = joinAnimator(runUpTo(trace, 2, testCtx()), stage, 2, testCtx());
    // непарная левая не краснеет
    const unmatched = phases[2].frame.tables.find((t) => t.id === 't:b');
    expect(unmatched?.rows.find((r) => r.key === 'b=(0,10)')?.state).toBe('normal');
    const a = phases[2].frame.tables.find((t) => t.id === 't:a');
    expect(a?.rows.find((r) => r.key === 'a=(0,6)')?.state).toBe('dropped');
    // в результате строка с null-половиной
    const rows = phases[3].frame.tables[0].rows;
    const noPair = rows.find((r) => r.key === 'b=(0,10)|a=∅');
    expect(noPair?.state).toBe('null-filled');
    expect(noPair?.values.slice(3)).toEqual([null, null]);
  });
  it('RIGHT: зеркально - правая без пары остаётся, левая половина NULL', () => {
    const trace = rightJoinTrace();
    const stage = trace.stages[2] as Extract<Stage, { kind: 'join' }>;
    const phases = joinAnimator(runUpTo(trace, 2, testCtx()), stage, 2, testCtx());
    const rows = phases[3].frame.tables[0].rows;
    const noPair = rows.find((r) => r.key === 'a=∅|b=(0,10)');
    expect(noPair?.state).toBe('null-filled');
    expect(noPair?.values.slice(0, 3)).toEqual([null, null, null]);
  });
  it('FULL: обе стороны без пар остаются', () => {
    const trace = fullJoinTrace();
    const stage = trace.stages[2] as Extract<Stage, { kind: 'join' }>;
    const phases = joinAnimator(runUpTo(trace, 2, testCtx()), stage, 2, testCtx());
    const rows = phases[3].frame.tables[0].rows;
    expect(rows.find((r) => r.key === 'b=(0,10)|a=∅')?.state).toBe('null-filled');
    expect(rows.find((r) => r.key === '∅|a=(0,6)')?.state).toBe('null-filled');
  });
});
```

  Фикстуры `rightJoinTrace()` и `fullJoinTrace()` - дописать в `__fixtures__/traces.ts` рядом с `leftJoinTrace()`: те же книги и авторы, `joinType: 'right'` / `'full'`, пары с null-половинами, ключи строк `a=∅|b=(0,10)` / `∅|a=(0,6)`.

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/overlay/animators/join.test.ts`. Ожидаемо: новые тесты падают (`state` не `null-filled`, строки без пары ушли).

- [ ] **Шаг 4. Реализация** - в `join.ts` обобщить фазу unmatched и merge:

```ts
  const keepsLeft = stage.joinType === 'left' || stage.joinType === 'full';
  const keepsRight = stage.joinType === 'right' || stage.joinType === 'full';
  // непарные краснеют только на стороне, которая их отбрасывает
  const dropped = (t: typeof left, side: 'left' | 'right') => mapRows(clearMarks(t), (r) =>
    paired.has(r.key) ? {} : { state: (side === 'left' ? keepsLeft : keepsRight) ? 'normal' : 'dropped' as const });
  // строки результата без пары - null-filled
  const merged = result.rows.map((r) => {
    const hasNullHalf = r.values.includes(null);
    return hasNullHalf ? { ...r, state: 'null-filled' as const } : r;
  });
```

  RIGHT: в фазе approach правая таблица остаётся на месте, левая подъезжает к ней справа (зеркальный сдвиг); в фазе merge результат ставится на место правой. Заголовок результата и id - те же конвенции, порядок алиасов в id не меняется.

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 9 passed (9)`.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.8\*\*|✅ ($(date +%F)) **P7.8**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/overlay/animators/join.ts src/features/overlay/animators/join.test.ts src/features/overlay/__fixtures__/traces.ts docs/PROGRESS.md
git commit -m "feat(overlay): аниматоры LEFT, RIGHT и FULL с NULL-половинами

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 7. Аниматор CROSS: веер и сетка N×M (P7.9)

Каждая левая строка веером раскладывается на все правые: фаза веера рисует линии пар для всех комбинаций (N×M линий - для учебных данных это десятки), фаза сетки собирает таблицу-результат со счётчиком `N × M = K` (спека 4 «CROSS JOIN»).

**Files:**
- Create: `src/features/overlay/animators/cross.ts`
- Modify: `src/features/overlay/animators/join.ts` (вызов `crossPhases`), `src/features/overlay/animators/join.test.ts`, `src/features/overlay/__fixtures__/traces.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `joinTableId`, `rebuildTable`, `counterNear`, `pair-line`.
- Produces: `crossPhases(prev, stage, stageIndex, ctx): Phase[]` - фазы `fan` (веер линий от каждой левой строки ко всем правым) и `grid` (таблица-результат + счётчик `N × M = K`).

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.9\*\*|🔄 ($(date +%F)) **P7.9**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Фикстура** `crossJoinTrace()` в `__fixtures__/traces.ts`: book 3 строки × customer 2 строки, `joinType: 'cross'`, `onColumns: []`, 6 пар, output 6 строк с ключами `b=(0,1)|c=(0,1)` и т.д.

- [ ] **Шаг 3. Падающие тесты** - дописать в `join.test.ts`:

```ts
describe('joinAnimator: CROSS', () => {
  it('веер линий ко всем правым строкам и сетка со счётчиком', () => {
    const trace = crossJoinTrace();
    const stage = trace.stages[2] as Extract<Stage, { kind: 'join' }>;
    const phases = joinAnimator(runUpTo(trace, 2, testCtx()), stage, 2, testCtx());
    expect(phases.map((p) => p.id)).toEqual(['2:fan', '2:grid']);
    const fan = phases[0].frame.decorations.filter((d) => d.kind === 'pair-line');
    expect(fan).toHaveLength(6); // 3 × 2
    expect(fan.filter((l) => l.kind === 'pair-line' && l.from.row === 'b=(0,1)')).toHaveLength(2);
    const grid = phases[1].frame.tables[0];
    expect(grid.id).toBe('t:b|c');
    expect(grid.rows).toHaveLength(6);
    expect(phases[1].frame.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '3 × 2 = 6' }));
    expect(phases[1].caption).toBe(stage.caption);
  });
  it('большая сетка уходит в сжатый вид', () => {
    const big = crossJoinTrace(); // 11 × 6 = 66 строк: переопределить output.rows на 66 строк
    const stage = { ...(big.stages[2] as Extract<Stage, { kind: 'join' }>), output: { columns: [], rows: Array.from({ length: 66 }, (_, i) => ({ key: `r${i}`, lineage: {}, values: [i] })) } };
    const phases = joinAnimator(runUpTo(big, 2, testCtx()), stage, 2, testCtx());
    const grid = phases[1].frame.tables[0];
    expect(grid.rows.length).toBeLessThanOrEqual(20);
    expect(grid.hiddenRows).toBe(46);
  });
});
```

- [ ] **Шаг 4. Запуск:** `pnpm vitest run --project node src/features/overlay/animators/join.test.ts`. Ожидаемо: `Cannot find module './cross'` (или переход в generic: одна фаза без веера).

- [ ] **Шаг 5. Реализация** `src/features/overlay/animators/cross.ts`:

```ts
import { counterNear, rebuildTable } from '../frame';
import { ghostWidth, TABLE_GAP } from '../geometry';
import { joinTableId } from './join';
import type { Animator, Frame, StageOf } from '../types';

// CROSS JOIN: веер линий от каждой левой строки ко всем правым, затем сетка N×M
export function crossPhases(prev: Frame, stage: StageOf<'join'>, stageIndex: number, ctx: AnimatorContext): Phase[] {
  const leftId = joinTableId(stage.leftAliases);
  const rightId = `t:${stage.rightAlias}`;
  const left = prev.tables.find((t) => t.id === leftId) ?? prev.tables.at(-1);
  const right = prev.tables.find((t) => t.id === rightId);
  if (!left || !right) return [{ id: `${stageIndex}:grid`, stageIndex, caption: stage.caption, durationMs: 500, frame: prev }];

  const near = { ...right, x: left.x + ghostWidth(left) + TABLE_GAP, y: left.y };
  const tables = prev.tables.map((t) => (t.id === rightId ? near : t));
  const lines = stage.pairs
    .filter(([l, r]) => l !== null && r !== null)
    .map(([l, r], i) => ({
      kind: 'pair-line' as const, id: `${stageIndex}:fan${i}`,
      from: { table: leftId, row: l, col: left.columns[0]?.name ?? '' },
      to: { table: rightId, row: r, col: right.columns[0]?.name ?? '' },
    }));

  const n = left.rows.length + (left.hiddenRows ?? 0);
  const m = right.rows.length + (right.hiddenRows ?? 0);
  const grid = rebuildTable({ id: joinTableId([...stage.leftAliases, stage.rightAlias]), title: `${stage.leftAliases.join('|')} × ${stage.rightAlias}`, x: left.x, y: left.y }, stage.output);
  const gridFrame = {
    tables: prev.tables.filter((t) => t.id !== leftId && t.id !== rightId).concat(grid),
    decorations: [counterNear(grid, `${stageIndex}:counter`, `${n} × ${m} = ${stage.pairs.length}`)],
  };

  return [
    { id: `${stageIndex}:fan`, stageIndex, caption: `CROSS JOIN: каждая строка слева соединяется с каждой справа`, durationMs: 800, frame: { tables, decorations: lines } },
    { id: `${stageIndex}:grid`, stageIndex, caption: stage.caption, durationMs: 700, frame: gridFrame },
  ];
}
```

  В `join.ts` заменить заглушку на импорт: `import { crossPhases } from './cross';`. `rebuildTable` сжимает >200 строк автоматически (Ф6, `ghostRows`) - тест «большая сетка» проходит без правок.

- [ ] **Шаг 6. Запуск:** та же команда. Ожидаемо: `Tests 11 passed (11)`.

- [ ] **Шаг 7. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.9\*\*|✅ ($(date +%F)) **P7.9**|" docs/PROGRESS.md
```

- [ ] **Шаг 8. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/overlay/animators/cross.ts src/features/overlay/animators/join.ts src/features/overlay/animators/join.test.ts src/features/overlay/__fixtures__/traces.ts docs/PROGRESS.md
git commit -m "feat(overlay): аниматор CROSS JOIN с веером и сеткой N на M

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 8. Трассировщик group и агрегаты (P7.10)

Стадия `group` идёт после filter и до project. Групповая проба (спека 5.6): `SELECT <ключи>, array_agg(<lineage>), <агрегаты> FROM ... WHERE ... GROUP BY <ключи> ORDER BY <ключи>`. Члены групп - RowKey строк входа (склеенные lineage, NULL-ctid → `∅`). Строки после group - группы с ключами `g:N`, `ctx.rows` / `ctx.columns` заменяются, все дальнейшие пробы (P, distinct, sort, limit) получают суффикс `GROUP BY` через новое поле `ctx.sql.group`. Сопоставление строк P с группами - по каноническим значениям ключей: у P ключи добавлены дополнительными колонками. Агрегат без GROUP BY - одна группа из всех строк, даже пустая (count = 0). Whitelist открывает `group`, `having`, `aggregate`; volatile в агрегатах запрещается (`volatile-other`).

**Files:**
- Create: `src/features/tracer/select/group.ts`, `src/features/tracer/select/group.test.ts`
- Modify: `src/features/tracer/select/context.ts`, `src/features/tracer/select/pipeline.ts`, `src/features/tracer/whitelist.ts`, `src/features/tracer/captions.ts`, `src/features/tracer/trace.ts`, `src/features/tracer/select/project.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `SelectCtx`, `prober`, `sqlOf`, `canon`, `rowKeyOf`, `groupKey`.
- Produces:
  - `aggregateExprs(sel: SelectStmt): string[]` - уникальные тексты `sqlOf` агрегатных FuncCall из targetList и havingClause (без дубликатов, в порядке появления);
  - `groupStep: SelectStep`: стадия `{ kind: 'group', keys, groups: [{ key: 'g:N', members: RowKey[] }], aggregates }`, output = ключи + агрегаты;
  - SelectCtx: `sql.group` (пусто или `GROUP BY <exprs>`), `groupOf: Map<string, number>` (канон значений ключей → индекс группы) для сопоставления строк P;
  - `loadOrdered` при `sql.group` строит групповую P: `SELECT <targets>, <ключи> FROM ... WHERE ... GROUP BY <ключи> ORDER BY <исходный ORDER BY, ключи>` и ключ строки = `g:N`.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.10\*\*|🔄 ($(date +%F)) **P7.10**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** `src/features/tracer/select/group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { column, stageOf, summary, traceSql } from '../../../../tests/helpers/trace';

describe('стадия group', () => {
  it('GROUP BY: группы, NULL-ключ в своей группе, значения агрегатов', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, count(*) from book group by author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6');
        const group = stageOf(trace, 'group');
        expect(group.keys).toEqual(['author_id']);
        expect(group.aggregates).toEqual(['count(*)']);
        expect(group.groups).toHaveLength(6);
        const nullGroup = group.groups.find((g) => column(group, 'author_id')[Number(g.key.slice(2))] === null);
        expect(nullGroup?.members).toEqual(['b=(0,10)', 'b=(0,11)']);
        expect(column(group, 'count')).toEqual([2, 1, 2, 2, 2, 2]); // ORDER BY author_id, NULL последняя
        expect(group.output.rows.map((r) => r.key)).toEqual(['g:0', 'g:1', 'g:2', 'g:3', 'g:4', 'g:5']);
      }),
    ));
  it('агрегат без GROUP BY: одна строка даже на пустом входе', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*) from book where price > 9000');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > filter:0 > group:1 > project:1');
        const group = stageOf(trace, 'group');
        expect(group.keys).toEqual([]);
        expect(group.groups).toEqual([{ key: 'g:0', members: [] }]);
        expect(column(group, 'count')).toEqual([0]);
      }),
    ));
  it('count(*) vs count(col): NULL не считается', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select count(*), count(price) from book');
        const group = stageOf(trace, 'group');
        expect(column(group, 'count')).toEqual([[11, 10]]);
      }),
    ));
  it('выражение над агрегатами: значения из пробы P, агрегаты в списке стадии', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, sum(price) as total, round(avg(price), 2) as avg_price from book group by author_id');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > project:6');
        const group = stageOf(trace, 'group');
        expect(group.aggregates).toEqual(['sum(price)', 'avg(price)']);
        const project = stageOf(trace, 'project');
        expect(project.computed).toEqual(['avg_price']);
        // author 1: книги 890 и 350, sum 1230.00
        const i = column(group, 'author_id').findIndex((v) => v === 1);
        expect(column(group, 'sum')[i]).toBe('1230.00');
      }),
    ));
  it('group после join: члены группы с составными ключами', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > group:3 > project:3');
        const group = stageOf(trace, 'group');
        expect(group.groups.every((g) => g.members.every((m) => /^b=\(0,\d+\)\|a=\(0,\d+\)$/.test(m)))).toBe(true);
        expect(column(group, 'count')).toEqual([2, 4, 3]); // ORDER BY country: Бразилия, Россия, Франция
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/group.test.ts`. Ожидаемо: `Пока не анимируется: GROUP BY` / `агрегатные функции` - всё падает на final-only.

- [ ] **Шаг 4. Реализация.** `whitelist.ts`: `SUPPORTED` += `'group'`, `'having'`, `'aggregate'`; в `selectFeatures` после сбора фич добавить: `if ((f.has('volatile')) && (f.has('group') || f.has('having') || f.has('aggregate'))) f.add('volatile-other')`. `captions.ts`:

```ts
  group: (keys: string[], groups: number, rows: number) => `GROUP BY ${keys.join(', ')}: ${rowsWord(rows)} → ${groups} ${plural(groups, 'группа', 'группы', 'групп')}`,
  aggregateNoGroup: (rows: number) => `Агрегат без GROUP BY: ${rowsWord(rows)} → 1 строка`,
```

  `select/group.ts`:

```ts
import type { FuncCall, Node, SelectStmt } from '@pgsql/types';
import { captions } from '../captions';
import { ident, sqlOf } from '../probe';
import { groupKey, rowKeyOf } from '../rowkey';
import type { Row, RowKey } from '../types';
import { canon } from '../verify';
import { AGGREGATES, funcName, walk } from '../whitelist';
import { rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// Уникальные агрегатные выражения из SELECT и HAVING (в порядке появления)
export function aggregateExprs(sel: SelectStmt): string[] {
  const out: string[] = [];
  walk([sel.targetList, sel.havingClause], (key, value) => {
    if (key !== 'FuncCall') return;
    const fc = value as FuncCall;
    if (!fc.over && (fc.agg_star || fc.agg_distinct !== undefined || AGGREGATES.has(funcName(fc)))) {
      const text = sqlOf({ FuncCall: fc } as Node);
      if (!out.includes(text)) out.push(text);
    }
  });
  return out;
}

// GROUP BY и агрегаты: строки становятся группами с ключами g:N
export const groupStep: SelectStep = {
  name: 'group',
  applies: (ctx) => Boolean(ctx.sel.groupClause) || aggregateExprs(ctx.sel).length > 0,
  async run(ctx) {
    const { sel, sql } = ctx;
    const keys = (sel.groupClause ?? []).map(sqlOf);
    const aggs = aggregateExprs(sel);
    const nAliases = ctx.aliasOrder.length;
    // lineage с coalesce: NULL-ctid (сторона без пары) не должен съесть конкатенацию
    const memberExpr = ctx.aliasOrder
      .map((a) => `coalesce(${ident(a)}.ctid::text, '∅')`)
      .join(` || '|' || `);
    const keySql = keys.map((k) => `(${k}) AS __vs_g${keys.indexOf(k)}`).join(', ');
    const probe = keys.length
      ? `SELECT ${keys.join(', ')}, array_agg(${memberExpr}) AS __vs_members${aggs.length ? `, ${aggs.join(', ')}` : ''}
         FROM ${sql.fromClause}${sql.where}
         GROUP BY ${keys.join(', ')} ORDER BY ${keys.join(', ')}`
      : `SELECT array_agg(${memberExpr}) AS __vs_members${aggs.length ? `, ${aggs.join(', ')}` : ''}
         FROM ${sql.fromClause}${sql.where}`;
    const r = await ctx.prober.rows(probe);
    const fields = keys.length ? r.fields.slice(1) : r.fields; // без __vs_members
    const types = await ctx.typeNames(fields.filter((f) => f.name !== '__vs_members').map((f) => f.dataTypeID));
    const colNames = keys.length ? r.fields.slice(1).map((f) => f.name) : aggs; // имена ключей отдаёт Postgres
    const groups: Array<{ key: RowKey; members: RowKey[] }> = [];
    const rows: Row[] = r.rows.map((row, i) => {
      const raw = row[0] as string[] | null;
      const members = (raw ?? []).map((m) => m.split('|').join('|')).map((m) => {
        const parts = m.split('|');
        const lineage: Record<string, string | null> = {};
        ctx.aliasOrder.forEach((a, j) => { lineage[a] = parts[j] === '∅' ? null : parts[j]; });
        return rowKeyOf(lineage, ctx.aliasOrder);
      }).sort(compareRowKeys);
      groups.push({ key: groupKey(i), members });
      // канон значений ключей для сопоставления строк P
      const keyValues = keys.length ? row.slice(1, 1 + keys.length) : [];
      ctx.groupOf.set(keyValues.map(canon).join('\u0001'), i);
      return {
        key: groupKey(i),
        lineage: {},
        values: keys.length ? [...row.slice(1, 1 + keys.length), ...row.slice(1 + keys.length + 1)] : row.slice(1),
      };
    });
    ctx.columns = [
      ...keys.map((k, i) => ({ name: colNames[i] ?? k, type: types.get(...)?.toString() ?? 'unknown' })),
      ...aggs.map((a, i) => ({ name: colNames[keys.length + i] ?? a, type: types.get(fields[1 + i].dataTypeID) ?? 'unknown' })),
    ];
    ctx.rows = rows;
    ctx.stages.push({
      id: stageId(ctx, 'group'),
      kind: 'group',
      keys,
      groups,
      aggregates: aggs,
      sourceRange: rangeOf(ctx.stmt, 'group'),
      caption: keys.length ? captions.group(keys, groups.length, before(ctx)) : captions.aggregateNoGroup(before(ctx)),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};

// физический порядок ключей '(0,10)' < '(0,2)' лексикографически неверен - сравниваем как кортеж
function compareRowKeys(a: string, b: string): number {
  const parse = (k: string) => k.split('|').map((part) => part.split('=').at(-1) ?? '').map((p) => p.split(',').map(Number));
  const pa = parse(a).flat();
  const pb = parse(b).flat();
  return pa.some((v, i) => v !== pb[i]) ? (pa.findIndex((v, i) => v !== pb[i]) >= 0 && pa[pa.findIndex((v, i) => v !== pb[i])] < pb[pa.findIndex((v, i) => v !== pb[i])] ? -1 : 1) : 0;
}
```

  (код выше - полный по логике, но сокращён в деталях: `sql.fromClause` - это `sql.from`; `before(ctx)` - число строк до группировки, взять из предыдущей стадии; `ctx.groupOf` объявить в SelectCtx как `Map<string, number>`; `colNames` для без-GROUP BY - имена агрегатов из probe fields. Реализовать аккуратно по этим сигнатурам, тесты укажут.)

  `context.ts`:
  - `sql.group` = `sel.groupClause ? ` GROUP BY ${keys.join(', ')}` : ''`; вставляется во все пробы после группировки: в `loadOrdered` (P), `loadOutputs` не нужно (LIMIT 0 допустим с GROUP BY), `distinct`-пробу, сжатый режим;
  - `loadOrdered` при `sql.group`: P = `SELECT <targets>, <ключи-exprs>${sql.from}${sql.where}${sql.group} ORDER BY <исходный порядок, ключи>`; строка P сопоставляется с группой через `ctx.groupOf.get(канон значений ключей)`; `order` / `values` / `tuple` ключуются `g:N`.

  `pipeline.ts`: `[scanStep, joinStep, filterStep, groupStep, havingStep, projectStep, ...]` (havingStep появится в задаче 9 - пока без него). `project.ts`: `projection(out, scanColumns)` заменить на `projection(out, ctx.columns.map((c) => c.name))` - kept/removed считаются относительно текущих колонок (после group это ключи и агрегаты). `trace.ts`: без изменений (пайплайн сам вызывает шаги).

- [ ] **Шаг 5. Запуск:** `pnpm vitest run --project node src/features/tracer/select/group.test.ts`. Ожидаемо: `Tests 5 passed (5)`. Затем вся папка `src/features/tracer` - фаззер Ф5 (distinct/limit с группировкой) зелёный. Если падает сопоставление P - проверь `groupOf`: канон значений ключей обязан совпадать между групповой пробой и P (обе считают `keys` одинаковыми выражениями).

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.10\*\*|✅ ($(date +%F)) **P7.10**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/group.ts src/features/tracer/select/group.test.ts src/features/tracer/select/context.ts src/features/tracer/select/pipeline.ts src/features/tracer/select/project.ts src/features/tracer/whitelist.ts src/features/tracer/captions.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия group с агрегатами и группами по ключам

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 9. Стадия filter для HAVING (P7.11)

HAVING - это стадия `filter` с `clause: 'having'` (контракт Ф5 уже различает). Проба: `SELECT <ключи>, (<HAVING>) AS __vs_pred FROM ... WHERE ... GROUP BY <ключи>` - вердикты true / false / null по группам, сопоставление через `ctx.groupOf`. Остаются только группы с `true`. Фильтр-аниматор Ф6 уже рисует вердикты по ключам строк - для групп он работает без правок: строки кадра после group-аниматора имеют ключи `g:N`.

**Files:**
- Create: `src/features/tracer/select/having.ts`
- Modify: `src/features/tracer/select/filter.ts` (обобщение на групповой вход), `src/features/tracer/select/pipeline.ts`, `src/features/tracer/select/group.test.ts`, `src/features/tracer/captions.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `groupStep`, `ctx.groupOf`, `ctx.sql.group`, `filterStep` (Ф5).
- Produces: `havingStep: SelectStep` - стадия `filter` c `clause: 'having'`, вердикты `Record<'g:N', true | false | null>`; `predicateColumns` - колонки из HAVING.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.11\*\*|🔄 ($(date +%F)) **P7\.11**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** - дописать в `src/features/tracer/select/group.test.ts`:

```ts
describe('стадия having', () => {
  it('HAVING: фильтр по группам, вердикты по g:N', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, count(*) from book group by author_id having count(*) > 1');
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe('scan:11 > group:6 > filter:5 > project:5');
        const filter = stageOf(trace, 'filter');
        expect(filter.clause).toBe('having');
        expect(filter.verdicts['g:2']).toBe(false); // author 2 - одна книга
        expect(Object.values(filter.verdicts).filter((v) => v === true)).toHaveLength(5);
        expect(filter.caption).toBe('HAVING: осталось 5 из 6 групп');
      }),
    ));
  it('HAVING по ключу: NULL-группа проходит отдельно', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select author_id, count(*) from book group by author_id having author_id is null');
        expect(summary(trace)).toBe('scan:11 > group:6 > filter:1 > project:1');
        expect(column(stageOf(trace, 'filter'), 'count')).toEqual([2]);
      }),
    ));
  it('HAVING после join по агрегату обеих сторон', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country having count(*) >= 3');
        expect(summary(trace)).toBe('scan:11 > scan:6 > join:9 > group:3 > filter:1 > project:1');
        expect(column(stageOf(trace, 'filter'), 'country')).toEqual(['Россия']);
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/select/group.test.ts`. Ожидаемо: новые 3 теста падают (`Error: нет стадии filter` с clause having / summary без filter).

- [ ] **Шаг 4. Реализация** `src/features/tracer/select/having.ts`:

```ts
import type { Node } from '@pgsql/types';
import { captions } from '../captions';
import { sqlOf } from '../probe';
import { groupKey } from '../rowkey';
import type { RowKey } from '../types';
import { canon } from '../verify';
import { walk } from '../whitelist';
import { rangeOf, stageId } from './context';
import type { SelectStep } from './pipeline';

// HAVING: вердикты по группам, остаются только true
export const havingStep: SelectStep = {
  name: 'having',
  applies: (ctx) => Boolean(ctx.sel.havingClause),
  async run(ctx) {
    const having = ctx.sel.havingClause as Node;
    const keys = (ctx.sel.groupClause ?? []).map(sqlOf);
    const keySql = keys.length ? `${keys.join(', ')}, ` : '';
    const r = await ctx.prober.rows(
      `SELECT ${keySql}(${sqlOf(having)}) AS __vs_pred${ctx.sql.from}${ctx.sql.where}${ctx.sql.group}`,
    );
    const verdicts: Record<RowKey, true | false | null> = {};
    r.rows.forEach((row, i) => {
      const keyValues = keys.length ? row.slice(0, keys.length) : [];
      const groupIdx = ctx.groupOf.get(keyValues.map(canon).join('\u0001')) ?? i;
      verdicts[groupKey(groupIdx)] = row[keys.length] as boolean | null;
    });
    // без GROUP BY всегда одна группа
    if (!keys.length) verdicts[groupKey(0)] = r.rows[0]?.[0] as boolean | null ?? null;
    const before = ctx.rows.length;
    ctx.rows = ctx.rows.filter((row) => verdicts[row.key] === true);
    const predicateColumns = new Set<string>();
    walk(having, (key, value) => {
      if (key !== 'ColumnRef') return;
      const last = (value as { fields?: Node[] }).fields?.at(-1);
      const name = last && 'String' in last ? last.String.sval : undefined;
      if (name) predicateColumns.add(name);
    });
    ctx.stages.push({
      id: stageId(ctx, 'filter'),
      kind: 'filter',
      clause: 'having',
      verdicts,
      predicateColumns: [...predicateColumns],
      sourceRange: rangeOf(ctx.stmt, 'having'),
      caption: captions.having(before, ctx.rows.length, Object.values(verdicts).filter((v) => v === null).length),
      output: { columns: ctx.columns, rows: ctx.rows },
    });
  },
};
```

  `captions.ts`: `having: (before, after, unknown) => \`HAVING: осталось ${after} из ${before} ${plural(before, 'группа', 'группы', 'групп')}${unknown ? `, UNKNOWN у ${unknown}` : ''}\``. `pipeline.ts`: вставить `havingStep` между `groupStep` и `projectStep`. `filter.ts` не меняется (WHERE идёт до group), но `loadOrdered` при `sql.group` должен вставлять `${sql.group}` в пробу P (сделано в задаче 8).

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 8 passed (8)`.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.11\*\*|✅ ($(date +%F)) **P7.11**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/select/having.ts src/features/tracer/select/group.test.ts src/features/tracer/select/pipeline.ts src/features/tracer/captions.ts docs/PROGRESS.md
git commit -m "feat(tracer): стадия HAVING с вердиктами по группам

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 10. Аниматоры GROUP BY и агрегата (P7.12, P7.13)

Один аниматор `groupAnimator` на стадию `group`. Фазы: `color` (строки окрашиваются в цвет своей группы, `GhostRow.group` + `bracket`-скобки по группам), `stack` (члены групп съезжаются в стопки - перестановка строк в таблице), `collapse` (пересборка из output: строки-группы, колонки не из GROUP BY перечёркнуты, счётчик `11 → 6`). Агрегат без GROUP BY - та же логика с одной группой: все строки в одной скобке, счётчик `11 → 1`, значение агрегата «набегает» в подписи фазы. `count(col)` vs `count(*)`: у строк-участников с NULL в агрегируемой колонке бейдж `NULL не считается` (спека: NULL-ячейки мигают серым и не засчитываются).

**Files:**
- Modify: `src/features/overlay/__fixtures__/traces.ts`, `src/features/overlay/animators/index.ts`, `docs/PROGRESS.md`
- Create: `src/features/overlay/animators/group.ts`, `src/features/overlay/animators/group.test.ts`

**Interfaces:**
- Consumes: `rebuildTable`, `mapRows`, `mapColumns`, `clearMarks`, `counterNear`, `withTable`, `bracket`, `runUpTo`, категориальная палитра групп (Ф6, семантические цвета).
- Produces: `groupAnimator: Animator<StageOf<'group'>>` с фазами `color`, `stack`, `collapse`; регистрация в `ANIMATORS`.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.12\*\*|🔄 ($(date +%F)) **P7.12**|" docs/PROGRESS.md
sed -i '' "s|⬜ \*\*P7\.13\*\*|🔄 ($(date +%F)) **P7.13**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Фикстуры** - дописать в `__fixtures__/traces.ts`:

```ts
// select author_id, count(*) from book group by author_id (сокращённо: 4 книги, 3 группы)
export function groupTrace(): Trace {
  const cols = [
    { name: 'book_id', type: 'bigint', source: { alias: 'b', column: 'book_id' } },
    { name: 'title', type: 'text', source: { alias: 'b', column: 'title' } },
    { name: 'author_id', type: 'bigint', source: { alias: 'b', column: 'author_id' } },
  ];
  const rows = BOOKS2; // из joinTrace: авторы 1, 1, 3, null
  const groupCols = [
    { name: 'author_id', type: 'bigint', source: { alias: 'b', column: 'author_id' } },
    { name: 'count', type: 'bigint' },
  ];
  const stages: Stage[] = [
    { id: 's0', kind: 'scan', alias: 'b', tableId: 'public.book', caption: 'FROM book: 4 строки', output: { columns: cols, rows } },
    {
      id: 's1', kind: 'group', keys: ['author_id'], aggregates: ['count(*)'],
      groups: [
        { key: 'g:0', members: ['b=(0,1)', 'b=(0,3)'] },
        { key: 'g:1', members: ['b=(0,4)'] },
        { key: 'g:2', members: ['b=(0,10)'] },
      ],
      caption: 'GROUP BY author_id: 4 строки → 3 группы',
      output: {
        columns: groupCols,
        rows: [
          { key: 'g:0', lineage: {}, values: [1, 2] },
          { key: 'g:1', lineage: {}, values: [3, 1] },
          { key: 'g:2', lineage: {}, values: [null, 1] },
        ],
      },
    },
    { id: 's2', kind: 'project', kept: ['author_id', 'count'], removed: [], computed: [], renamed: {}, caption: 'SELECT', output: { columns: groupCols, rows: stages[0] ? [] as never : [] } },
  ];
  return { ...joinTrace(), sql: 'select author_id, count(*) from book group by author_id', stages };
}

// select count(*) from book (агрегат без GROUP BY)
export function aggregateTrace(): Trace {
  const countCols = [{ name: 'count', type: 'bigint' }];
  const stages: Stage[] = [
    { id: 's0', kind: 'scan', alias: 'b', tableId: 'public.book', caption: 'FROM book: 4 строки', output: { columns: bCols, rows: BOOKS2 } },
    {
      id: 's1', kind: 'group', keys: [], aggregates: ['count(*)'],
      groups: [{ key: 'g:0', members: ['b=(0,1)', 'b=(0,3)', 'b=(0,4)', 'b=(0,10)'] }],
      caption: 'Агрегат без GROUP BY: 4 строки → 1 строка',
      output: { columns: countCols, rows: [{ key: 'g:0', lineage: {}, values: [4] }] },
    },
    { id: 's2', kind: 'project', kept: ['count'], removed: [], computed: [], renamed: {}, caption: 'SELECT', output: { columns: countCols, rows: stages[1].output.rows } },
  ];
  return { ...joinTrace(), sql: 'select count(*) from book', stages };
}
```

  (в фикстуре groupTrace последняя стадия project ссылается на rows стадии group - вынести в переменную, а не `[] as never`.)

- [ ] **Шаг 3. Падающие тесты** `src/features/overlay/animators/group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateTrace, groupTrace, testCtx } from '../__fixtures__/traces';
import { runUpTo } from '../__fixtures__/runUpTo';
import { groupAnimator } from './group';

describe('groupAnimator', () => {
  const trace = groupTrace();
  const stage = trace.stages[1] as Extract<Stage, { kind: 'group' }>;
  const before = runUpTo(trace, 1, testCtx());
  const phases = groupAnimator(before, stage, 1, testCtx());

  it('три фазы: окраска, стопки, схлопывание', () => {
    expect(phases.map((p) => p.id)).toEqual(['1:color', '1:stack', '1:collapse']);
  });
  it('строки окрашены по группам, у одиночных групп цвета нет', () => {
    const rows = phases[0].frame.tables[0].rows;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['b=(0,1)'].group).toBe(0);
    expect(byKey['b=(0,3)'].group).toBe(0);
    expect(byKey['b=(0,4)'].group).toBe(1);
  });
  it('стопки съезжаются: члены групп рядом, bracket по каждой группе', () => {
    const rows = phases[1].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,3)', 'b=(0,4)', 'b=(0,10)']);
    const brackets = phases[1].frame.decorations.filter((d) => d.kind === 'bracket');
    expect(brackets).toHaveLength(3);
    expect(brackets[0]).toMatchObject({ kind: 'bracket', table: 't:b', fromRow: 0, toRow: 1, color: 0 });
  });
  it('колонки не из группы перечёркнуты, после схлопывания строки-группы', () => {
    const stack = phases[1].frame.tables[0];
    expect(stack.columns.find((c) => c.name === 'title')?.state).toBe('removed');
    expect(stack.columns.find((c) => c.name === 'author_id')?.state).toBe('key');
    const collapsed = phases[2].frame.tables[0];
    expect(collapsed.rows.map((r) => [r.key, r.values])).toEqual([
      ['g:0', [1, 2]], ['g:1', [3, 1]], ['g:2', [null, 1]],
    ]);
    expect(phases[2].frame.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '4 → 3' }));
    expect(phases[2].caption).toBe(stage.caption);
  });
  it('агрегат без GROUP BY: одна группа, все строки в скобке, счётчик 4 → 1', () => {
    const agg = aggregateTrace();
    const p = groupAnimator(runUpTo(agg, 1, testCtx()), agg.stages[1] as Extract<Stage, { kind: 'group' }>, 1, testCtx());
    const brackets = p[1].frame.decorations.filter((d) => d.kind === 'bracket');
    expect(brackets).toHaveLength(1);
    expect(p[2].frame.tables[0].rows).toEqual([{ key: 'g:0', values: [4], state: 'normal' }]);
    expect(p[2].frame.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '4 → 1' }));
    expect(p[2].caption).toContain('count');
  });
  it('count(col): строки с NULL в колонке помечены бейджем', () => {
    const withNull = { ...stage, aggregates: ['count(price)'] };
    const p = groupAnimator(runUpTo(trace, 1, testCtx()), withNull, 1, testCtx());
    // «Простой Python» в фикстуре без NULL - пометим руками строку c null author_id как NULL-ячейку:
    // бейдж ставится строкам, у которых value агрегируемой колонки null
    const nullRow = p[1].frame.tables[0].rows.find((r) => r.key === 'b=(0,10)');
    expect(nullRow?.badge).toBe('NULL не считается');
  });
});
```

- [ ] **Шаг 4. Запуск:** `pnpm vitest run --project node src/features/overlay/animators/group.test.ts`. Ожидаемо: `Cannot find module './group'`.

- [ ] **Шаг 5. Реализация** `src/features/overlay/animators/group.ts`:

```ts
import { clearMarks, counterNear, mapColumns, mapRows, rebuildTable, withTable } from '../frame';
import type { RowKey } from '@/features/tracer/types';
import type { Animator, GhostRow, StageOf } from '../types';
import { genericAnimator } from './generic';

// GROUP BY: окраска по группам, стопки, схлопывание; агрегат без GROUP BY - одна группа
export const groupAnimator: Animator<StageOf<'group'>> = (prev, stage, stageIndex, ctx) => {
  const cur = prev.tables.at(-2) ?? prev.tables.at(-1); // до project кадр ещё не строился: текущая таблица
  const table = cur ?? prev.tables.at(-1);
  if (!table) return genericAnimator(prev, stage, stageIndex, ctx);
  const clean = clearMarks(table);

  // 1. окраска: group-индекс по членству
  const groupOfRow = new Map<RowKey, number>();
  stage.groups.forEach((g, i) => g.members.forEach((m) => groupOfRow.set(m, i)));
  const colored = mapRows(clean, (r) => ({ group: groupOfRow.get(r.key) }));

  // 2. стопки: члены групп рядом, bracket по каждой; одиночные группы без бейджа
  const byKey = new Map(clean.rows.map((r) => [r.key, r]));
  const ordered: GhostRow[] = [];
  const brackets = [];
  let rowIdx = 0;
  stage.groups.forEach((g, i) => {
    const members = g.members.map((m) => byKey.get(m)).filter((r) => r !== undefined) as GhostRow[];
    if (!members.length) return;
    members.forEach((m) => ordered.push({ ...m, group: i }));
    brackets.push({ kind: 'bracket' as const, table: table.id, fromRow: rowIdx, toRow: rowIdx + members.length - 1, color: i % 8, label: `${g.key}` });
    rowIdx += members.length;
  });
  for (const r of clean.rows) if (!groupOfRow.has(r.key)) ordered.push(r);
  const stacked = { ...colored, rows: ordered };

  // колонки не из GROUP BY и не агрегаты - перечёркнуты (объясняет 42803)
  const keyNames = new Set(stage.output.columns.slice(0, stage.keys.length).map((c) => c.name));
  const marked = mapColumns(stacked, (c) => ({ state: keyNames.has(c.name) ? 'key' as const : 'removed' as const }));

  // 3. схлопывание: строки-группы из выхода стадии
  const result = rebuildTable(table, stage.output);
  const before = totalRowsPrev(prev, stage);
  const collapsed = { ...result, rows: result.rows.map((r) => ({ ...r, group: undefined })) };

  return [
    { id: `${stageIndex}:color`, stageIndex, caption: `GROUP BY: строки окрашиваются по группам`, durationMs: 600, frame: { tables: withTable(prev, colored).tables, decorations: [] } },
    { id: `${stageIndex}:stack`, stageIndex, caption: `GROUP BY: члены групп съезжаются в стопки`, durationMs: 800, frame: { tables: withTable(prev, marked).tables, decorations: brackets } },
    { id: `${stageIndex}:collapse`, stageIndex, caption: stage.caption, durationMs: 700, frame: { tables: withTable(prev, collapsed).tables, decorations: [counterNear(collapsed, `${stageIndex}:counter`, `${before} → ${stage.output.rows.length}`)] } },
  ];
};
```

  Пояснения (реализовать по ним):
  - `count(col)`: колонка агрегата одна из `stage.output.columns` после ключей; строки, у которых в исходной таблице value этой колонки null, на фазе `stack` получают `badge: 'NULL не считается'`;
  - `totalRowsPrev(prev, stage)`: число строк таблицы до группировки (стадии group предшествует filter/scan; в кадре `prev` текущая таблица);
  - пустой вход у агрегата без GROUP BY (`groups: [{ members: [] }]`): brackets пуст, кадр collapse показывает одну строку `g:0` - заголовок таблицы остаётся, счётчик `0 → 1`;
  - регистрация: в `animators/index.ts` добавить `import { groupAnimator } from './group';` и `group: groupAnimator` в реестр `ANIMATORS`.

- [ ] **Шаг 6. Запуск:** та же команда. Ожидаемо: `Tests 6 passed (6)`.

- [ ] **Шаг 7. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.12\*\*|✅ ($(date +%F)) **P7.12**|" docs/PROGRESS.md
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.13\*\*|✅ ($(date +%F)) **P7.13**|" docs/PROGRESS.md
```

- [ ] **Шаг 8. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/overlay/__fixtures__/traces.ts src/features/overlay/animators/group.ts src/features/overlay/animators/group.test.ts src/features/overlay/animators/index.ts docs/PROGRESS.md
git commit -m "feat(overlay): аниматор GROUP BY со стопками и агрегат без GROUP BY

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 11. Визуал ошибки 42803 grouping_error (P7.14)

Postgres сам ловит колонку не из GROUP BY: `column "book.title" must appear in the GROUP BY clause...`. Трасса уже получает стадию `error` (механика Ф5). Здесь уточняем фокус: из message достаём квалифицированное имя колонки, через `relationsOf` (Ф4) находим таблицу и даём `focus.columns` с точным `public.book.title` вместо всего `touched`. Аниматор `error` Ф6 кадр не меняет - расширяем его: фокусные колонки рисуются призрачной таблицей с перечёркнутыми колонками у реальной ноды на доске. Словарь ошибок (Ф2, P2.14) уже содержит 42803 по спеке 5.14 - проверить текст, при неполной записи дополнить.

**Files:**
- Modify: `src/features/tracer/trace.ts`, `src/features/overlay/animators/error.ts`, `src/features/errors/dictionary.ts` (если нужно), `docs/PROGRESS.md`
- Create: `src/features/tracer/grouping-error.test.ts`

**Interfaces:**
- Consumes: стадия `error` (Ф5), `errorAnimator` (Ф6), `relationsOf` (Ф4), `explainError` / словарь (Ф2).
- Produces: `groupingErrorFocus(err: DbError, stmt: ParsedStatement): { tableIds: string[]; columns: string[] }` - парсинг `column "<schema.table.col | alias.col>"` из message и поиск таблицы; `errorAnimator` рисует таблицу-призрак с фокусными колонками в state `removed`.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.14\*\*|🔄 ($(date +%F)) **P7\.14**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** `src/features/tracer/grouping-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../tests/helpers/db';
import { stageOf, traceSql } from '../../tests/helpers/trace';
import { errorAnimator } from '@/features/overlay/animators/error';
import { testCtx } from '@/features/overlay/__fixtures__/traces';

describe('42803 grouping_error', () => {
  it('фокус - конкретная колонка не из GROUP BY, а не вся трасса', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, count(*) from book group by author_id');
        expect(trace).toMatchObject({ mode: 'final-only', error: { code: '42803' }, result: null });
        const error = stageOf(trace, 'error');
        expect(error.focus.columns).toEqual(['public.book.title']);
        expect(error.focus.tableIds).toEqual(['public.book']);
      }),
    ));
  it('квалифицированный алиас тоже резолвится', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select b.title from book b group by b.author_id');
        expect(stageOf(trace, 'error').focus.columns).toEqual(['public.book.title']);
      }),
    ));
  it('аниматор error перечёркивает фокусную колонку у таблицы на доске', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, 'select title, count(*) from book group by author_id');
        const phases = errorAnimator({ tables: [], decorations: [] }, stageOf(trace, 'error'), 0, testCtx());
        const t = phases[0].frame.tables.find((x) => x.id === 't:book');
        expect(t).toBeDefined();
        expect(t?.columns.find((c) => c.name === 'title')?.state).toBe('removed');
        expect(t?.columns.find((c) => c.name === 'author_id')?.state).not.toBe('removed');
        expect(phases[0].caption).toContain('42803');
      }),
    ));
});
```

- [ ] **Шаг 3. Запуск:** `pnpm vitest run --project node src/features/tracer/grouping-error.test.ts`. Ожидаемо: падения - `focus.columns` сейчас весь `touched` (все колонки запроса), аниматор не рисует таблицы.

- [ ] **Шаг 4. Реализация.** `trace.ts`: в ветке ошибки после `const error = e.db`:

```ts
    const focus = error.code === '42803' ? groupingErrorFocus(error, stmt, touched) : touched;
```

  и использовать `focus` в стадии `error`. Новая функция (рядом или в `whitelist.ts`):

```ts
// column "book.title" must appear in the GROUP BY clause... -> точный фокус
export function groupingErrorFocus(err: DbError, stmt: ParsedStatement, fallback: { tableIds: string[]; columns: string[] }) {
  const m = err.message.match(/column "([^"]+)" must appear/i);
  if (!m) return fallback;
  const parts = m[1].split('.');
  const column = parts.at(-1) as string;
  const qualifier = parts.length > 1 ? parts.slice(0, -1).join('.') : null; // 'book' или 'public.book'
  const rel = relationsOf(stmt).tables.find((t) => t.alias === qualifier || (qualifier?.includes('.') && `${t.schema}.${t.name}` === qualifier));
  const table = rel ? `${rel.schema ? `${rel.schema}.` : ''}${rel.name}` : null;
  if (!table) return fallback;
  return { tableIds: [table], columns: [`${table}.${column}`] };
}
```

  `animators/error.ts`: если `stage.focus.columns` не пуст и в `prev.tables` нет таблицы - построить призрак по `ctx.nodeRect(tableId)` из focus: `id: 't:' + имяТаблицы`, колонки из `ctx.schema` (таблицы фокуса), фокусные - `state: 'removed'`, строки не рисуем (пустые `rows`); caption дополняется человекочитаемым объяснением из словаря Ф2: `explainError(stage.error, { sql: '', schema: ctx.schema }).title`. Если таблицы уже есть в кадре - пометить колонки в них.

  `errors/dictionary.ts`: сверить запись 42803 со спекой 5.14 («Колонка должна быть в GROUP BY или внутри агрегата») - если текст уже есть из Ф2, не трогать.

- [ ] **Шаг 5. Запуск:** та же команда. Ожидаемо: `Tests 3 passed (3)`. Затем `pnpm vitest run --project node src/features/tracer` - не задеть старые тесты ошибки (`trace.test.ts` «ошибка Postgres» остаётся с focus = touched, т.к. 42703 не 42803).

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.14\*\*|✅ ($(date +%F)) **P7.14**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add src/features/tracer/trace.ts src/features/tracer/grouping-error.test.ts src/features/overlay/animators/error.ts docs/PROGRESS.md
git commit -m "feat(tracer): точный фокус и сцена ошибки 42803

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 12. Фаззер трассировщика и golden-набор Ф7 (P7.15)

Детерминированный генератор (PRNG mulberry32, фиксированный seed) собирает случайные запросы по bookstore: цепочка 1-4 таблиц через FK, случайные типы JOIN, USING при одноимённых ключах, 0-2 предиката WHERE, опциональные GROUP BY + агрегаты + HAVING, ORDER BY, LIMIT. Критерий честности: каждая трасса либо `full`, либо `final-only` с любой причиной, кроме «Сверка с прямым выполнением не сошлась» - такая причина означает баг проб. Порог доли `full`: 80% - иначе фаззер вырождается и ничего не проверяет. Дополнительно расширяем golden-набор Ф5 фиксированными запросами Ф7 (контракт плана Ф5: «Ф8 добавляет запросы уроков главы 4, Ф7 и Ф10 свои»).

**Files:**
- Create: `tests/tracer/fuzz-gen.ts`, `tests/tracer/fuzz.test.ts`
- Modify: `tests/tracer/golden.queries.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `withDataset`, `inPreview`, `traceSql`, `summary` (Ф5-хелперы), структуру bookstore.
- Produces:
  - `fuzzQueries(seed: number, count: number): string[]` - детерминированный список запросов;
  - `GOLDEN_F7: Array<{ sql: string; stages: string }>` - golden-строки Ф7;
  - тест фаззинга с таймаутом 240 с.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.15\*\*|🔄 ($(date +%F)) **P7.15**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Генератор** `tests/tracer/fuzz-gen.ts`:

```ts
// Детерминированный генератор запросов по bookstore: JOIN / WHERE / GROUP BY / ORDER BY / LIMIT.
// Только валидные запросы: соединения по FK, предикаты из пула, при GROUP BY в SELECT только ключи и агрегаты.

interface Rnd { int(min: number, max: number): number; pick<T>(xs: readonly T[]): T; chance(p: number): boolean }

function mulberry32(seed: number): Rnd {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (min, max) => min + Math.floor(next() * (max - min + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p };
}

interface Rel { table: string; alias: string }

const FKS: Array<[string, string, string, string]> = [
  ['book', 'author_id', 'author', 'author_id'],
  ['book', 'category_id', 'book_category', 'category_id'],
  ['orders', 'customer_id', 'customer', 'customer_id'],
  ['order_item', 'order_id', 'orders', 'order_id'],
  ['order_item', 'book_id', 'book', 'book_id'],
  ['review', 'book_id', 'book', 'book_id'],
  ['review', 'customer_id', 'customer', 'customer_id'],
  ['employee', 'manager_id', 'employee', 'employee_id'],
];

// пул допустимых предикатов: колонка -> текст условия без квалификации
const PRED: Record<string, string[]> = {
  price: ['price > 500', 'price < 1500', 'price is null', 'price between 300 and 900'],
  pages: ['pages > 300', 'pages < 200'],
  author_id: ['author_id is null', 'author_id is not null'],
  category_id: ['category_id is null'],
  country: ["country = 'Россия'", "country is distinct from 'Россия'"],
  born_year: ['born_year > 1850'],
  city: ['city is null', "city = 'Москва'"],
  bonus: ['bonus > 0'],
  status: ["status = 'paid'", "status in ('new', 'paid')"],
  qty: ['qty > 1'],
  rating: ['rating between 2 and 4', 'rating >= 4'],
  salary: ['salary > 100000'],
  manager_id: ['manager_id is null', 'manager_id is not null'],
};

const NUM_COLS: Record<string, string[]> = {
  book: ['price', 'pages'], author: ['born_year'], customer: ['bonus'], orders: [],
  order_item: ['qty', 'price'], employee: ['salary'], review: ['rating'], book_category: [],
};
const ALL_COLS: Record<string, string[]> = {
  book: ['book_id', 'title', 'author_id', 'category_id', 'price', 'pages', 'published_at', 'tags', 'meta'],
  author: ['author_id', 'name', 'country', 'born_year'],
  book_category: ['category_id', 'name', 'parent_id'],
  customer: ['customer_id', 'name', 'email', 'city', 'bonus', 'created_at'],
  orders: ['order_id', 'customer_id', 'status', 'created_at'],
  order_item: ['order_id', 'book_id', 'qty', 'price'],
  employee: ['employee_id', 'name', 'manager_id', 'position', 'salary', 'hired_at'],
  review: ['review_id', 'book_id', 'customer_id', 'rating', 'body', 'created_at'],
};

export function fuzzQueries(seed: number, count: number): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(genQuery(rnd));
  return out;
}

function genQuery(rnd: Rnd): string {
  const first = rnd.pick(Object.keys(ALL_COLS));
  const rels: Rel[] = [{ table: first, alias: 't0' }];
  const joinsSql: string[] = [];
  const joinCount = rnd.int(0, 3);
  for (let j = 1; j <= joinCount; j++) {
    const candidates = FKS.filter(([a, , b]) => {
      const aIn = rels.some((r) => r.table === a);
      const bIn = rels.some((r) => r.table === b);
      return (aIn && !bIn) || (bIn && !aIn);
    });
    if (!candidates.length) break;
    const fk = rnd.pick(candidates);
    // новая таблица - та сторона FK, которой ещё нет; ON всегда валиден по FK-колонкам
    const newTable = rels.some((r) => r.table === fk[0]) ? fk[2] : fk[0];
    const oldTable = newTable === fk[0] ? fk[2] : fk[0];
    const newCol = newTable === fk[0] ? fk[1] : fk[3];
    const oldCol = newTable === fk[0] ? fk[3] : fk[1];
    const newAlias = `t${j}`;
    const oldAlias = rels.find((r) => r.table === oldTable)!.alias;
    const sameName = fk[1] === fk[3];
    const type = rnd.chance(0.5) ? 'inner' : rnd.chance(0.55) ? 'left' : rnd.chance(0.55) ? 'right' : rnd.chance(0.5) ? 'full' : 'cross';
    const kw = { inner: 'join', left: 'left join', right: 'right join', full: 'full join', cross: 'cross join' }[type];
    const rel = `${newTable} ${newAlias}`;
    const tail = type === 'cross' || (type === 'inner' && rnd.chance(0.08))
      ? `cross join ${rel}`
      : sameName && rnd.chance(0.3)
        ? `${kw} ${rel} using (${newCol})`
        : `${kw} ${rel} on ${oldAlias}.${oldCol} = ${newAlias}.${newCol}`;
    joinsSql.push(tail);
    rels.push({ table: newTable, alias: newAlias });
  }
  const wheres: string[] = [];
  for (let w = rnd.int(0, 2); w > 0; w--) {
    const rel = rnd.pick(rels);
    const cols = Object.keys(PRED).filter((c) => ALL_COLS[rel.table].includes(c));
    if (!cols.length) continue;
    const col = rnd.pick(cols);
    wheres.push(`${rel.alias}.${rnd.pick(PRED[col])}`);
  }
  const withGroup = rnd.chance(0.4);
  let targets: string[];
  let group = '';
  let having = '';
  if (withGroup) {
    const rel = rnd.pick(rels);
    const key = rnd.pick(ALL_COLS[rel.table]);
    const numCols = NUM_COLS[rel.table].length ? NUM_COLS[rel.table] : [key];
    const aggs = [rnd.chance(0.5) ? 'count(*)' : `count(${rel.alias}.${rnd.pick(numCols)})`];
    if (rnd.chance(0.5)) aggs.push(`${rnd.pick(['sum', 'avg', 'min', 'max'])}(${rel.alias}.${rnd.pick(numCols)})`);
    targets = [`${rel.alias}.${key}`, ...aggs];
    group = ` group by ${rel.alias}.${key}`;
    if (rnd.chance(0.3)) having = ` having count(*) > ${rnd.int(1, 3)}`;
  } else {
    targets = rels.flatMap((r) => ALL_COLS[r.table].slice(0, rnd.int(1, 2)).map((c) => `${r.alias}.${c}`)).slice(0, rnd.int(1, 4));
  }
  const orders = rnd.chance(0.5)
    ? [withGroup ? '1' : rnd.pick(rels.flatMap((r) => ALL_COLS[r.table].map((c) => `${r.alias}.${c}`))) + (rnd.chance(0.4) ? ' desc' : ''), rnd.chance(0.3) ? '2' : ''].filter(Boolean)
    : [];
  const limit = rnd.chance(0.3) ? ` limit ${rnd.int(1, 15)}` : '';
  return [
    `select ${targets.join(', ')}`,
    `from ${rels[0].table} ${rels[0].alias}${joinsSql.length ? ` ${joinsSql.join(' ')}` : ''}`,
    wheres.length ? `where ${wheres.join(' and ')}` : '',
    group + having,
    orders.length ? `order by ${orders.join(', ')}` : '',
    limit,
  ].filter(Boolean).join(' ');
}
```

  (генератор полный по логике; при реализации сверить мелочи: `avg` без `round` даёт long numeric - для сверки неважно, канон сравнивает строки; `count(col)` на текстовой колонке допустим; ON при USING не пишется.)

- [ ] **Шаг 3. Тесты** `tests/tracer/fuzz.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initParser, parseSql } from '@/features/sql/parser';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';
import { fuzzQueries } from './fuzz-gen';

const QUERIES = fuzzQueries(20261008, 250);

describe('фаззер трассировщика', () => {
  it('все сгенерированные запросы парсятся', async () => {
    await initParser();
    for (const sql of QUERIES) {
      const parsed = parseSql(sql);
      expect(parsed.ok, sql).toBe(true);
    }
  });
  it('трасса либо full, либо честный final-only - никогда «сверка не сошлась»', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        for (const sql of QUERIES) {
          const trace = await traceSql(db, sql);
          expect(trace.mode === 'full' || trace.fallbackReason !== 'Сверка с прямым выполнением не сошлась', `${trace.fallbackReason}: ${sql}`).toBe(true);
        }
      }),
    ),
    240_000,
  );
  it('минимум 80% запросов дают полную трассу', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        let full = 0;
        for (const sql of QUERIES) if ((await traceSql(db, sql)).mode === 'full') full++;
        expect(full / QUERIES.length, `full только ${full} из ${QUERIES.length}`).toBeGreaterThanOrEqual(0.8);
      }),
    ),
    240_000,
  );
});
```

  (параметр таймаута - третий аргумент `it`: `it('...', async () => {...}, 240_000)` - поправить скобки при переносе, в черновике выше они искажены.)

- [ ] **Шаг 4. Golden-набор Ф7** - дописать в `tests/tracer/golden.queries.ts` (ожидания снять прогоном, как делал Ф5; здесь числа выведены из bookstore):

```ts
export const GOLDEN_F7: Array<{ sql: string; stages: string }> = [
  { sql: 'select b.title, a.name from book b join author a on b.author_id = a.author_id', stages: 'scan:11 > scan:6 > join:9 > project:9' },
  { sql: 'select b.title, a.name from book b left join author a on b.author_id = a.author_id', stages: 'scan:11 > scan:6 > join:11 > project:11' },
  { sql: 'select a.name, b.title from author a right join book b on a.author_id = b.author_id', stages: 'scan:6 > scan:11 > join:11 > project:11' },
  { sql: 'select b.title, a.name from book b full join author a on b.author_id = a.author_id', stages: 'scan:11 > scan:6 > join:12 > project:12' },
  { sql: 'select b.title, c.name from book b cross join customer c', stages: 'scan:11 > scan:6 > join:66 > project:66' },
  { sql: 'select b.title, c.name from book b, customer c limit 10', stages: 'scan:11 > scan:6 > join:66 > project:66 > limit:10' },
  { sql: 'select * from book b join author a using (author_id)', stages: 'scan:11 > scan:6 > join:9 > project:9' },
  { sql: 'select b.title, a.name from book b natural join author a', stages: 'scan:11 > scan:6 > join:9 > project:9' },
  { sql: 'select e.name, m.name from employee e join employee m on e.manager_id = m.employee_id', stages: 'scan:8 > scan:8 > join:7 > project:7' },
  { sql: 'select b.title, c.name, o.order_id from orders o join order_item oi on o.order_id = oi.order_id join book b on oi.book_id = b.book_id join customer c on o.customer_id = c.customer_id', stages: 'scan:8 > scan:15 > scan:11 > scan:6 > join:15 > join:15 > join:15 > project:15' },
  { sql: "select b.title from book b join author a on b.author_id = a.author_id where a.country = 'Россия'", stages: 'scan:11 > scan:6 > join:9 > filter:6 > project:6' },
  { sql: 'select b.title from book b left join author a on b.author_id = a.author_id and a.country is null', stages: 'scan:11 > scan:6 > join:11 > project:11' },
  { sql: 'select author_id, count(*) from book group by author_id', stages: 'scan:11 > group:6 > project:6' },
  { sql: 'select count(*), count(price) from book', stages: 'scan:11 > group:1 > project:1' },
  { sql: 'select author_id, sum(price) as total from book group by author_id order by total desc', stages: 'scan:11 > group:6 > project:6 > sort:6' },
  { sql: 'select author_id, count(*) from book group by author_id having count(*) > 1', stages: 'scan:11 > group:6 > filter:5 > project:5' },
  { sql: 'select a.country, count(*) from book b join author a on b.author_id = a.author_id group by a.country order by count(*) desc limit 2', stages: 'scan:11 > scan:6 > join:9 > group:3 > project:3 > sort:3 > limit:2' },
  { sql: 'select c.name, count(*) from customer c left join orders o on c.customer_id = o.customer_id group by c.name order by count(*) desc', stages: 'scan:6 > scan:8 > join:9 > group:6 > project:6 > sort:6' },
  { sql: 'select o.status, sum(oi.qty * oi.price) from orders o join order_item oi on o.order_id = oi.order_id group by o.status', stages: 'scan:8 > scan:15 > join:15 > group:4 > project:4' },
];
```

  Подключить в `golden.test.ts`: `it.each([...GOLDEN, ...GOLDEN_F7])('$sql', ...)`.

- [ ] **Шаг 5. Запуск:** `pnpm vitest run --project node tests/tracer/fuzz.test.ts tests/tracer/golden.test.ts`. Ожидаемо: всё зелёное. Любое «Сверка с прямым выполнением не сошлась» с конкретным SQL - это баг проб: разбирать через superpowers:systematic-debugging, сравнивая `trace.stages.at(-1).output` с `trace.result`; чинить пробу, а не ослаблять критерий. Если падает порог 80% - посмотреть `fallbackReason` распределение и добить самые частые причины.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.15\*\*|✅ ($(date +%F)) **P7.15**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add tests/tracer/fuzz-gen.ts tests/tracer/fuzz.test.ts tests/tracer/golden.queries.ts tests/tracer/golden.test.ts docs/PROGRESS.md
git commit -m "test(tracer): фаззер JOIN и агрегации + golden-набор фазы 7

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Задача 13. E2E: сцены JOIN и GROUP BY, скриншоты (P7.16)

Playwright-сцены поверх того же стенда, что `tests/e2e/overlay.spec.ts` Ф6 (страница с доской на датасете bookstore, редактор, плеер; селекторы и хелперы открытия - из Ф6, при необходимости общий код вынести в `tests/e2e/helpers.ts`). Проверяем: чипы стадий в логическом порядке, подписи с числами, строки и NULL-плашки в DOM, скриншот-снапшоты конечных состояний (спека 8: «Скриншот-снапшоты конечных состояний ключых сцен»).

**Files:**
- Create: `tests/e2e/join-group.spec.ts`
- Modify: `tests/e2e/helpers.ts` (если общий код придётся вынести из overlay.spec.ts), `docs/PROGRESS.md`

**Interfaces:**
- Consumes: стенд и селекторы Ф6 (`data-testid` чипов таймлайна, подписи стадий, контейнер сцены), `useEditorStore.insertQuery` (кнопка «▶ На доску» или ввод текста).
- Produces: 4 e2e-теста: INNER JOIN, LEFT JOIN (NULL-плашки), GROUP BY (стопки и схлопывание), FULL JOIN (обе NULL-половины); скриншоты конечных состояний.

- [ ] **Шаг 1. Трекер:**

```bash
sed -i '' "s|⬜ \*\*P7\.16\*\*|🔄 ($(date +%F)) **P7\.16**|" docs/PROGRESS.md
```

- [ ] **Шаг 2. Падающие тесты** `tests/e2e/join-group.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openLessonBoard, setQuery } from './helpers'; // из Ф6 / вынести в этой задаче

test.describe('сцены JOIN и GROUP BY', () => {
  test('INNER JOIN: чипы стадий, линии пар, счётчик пар', async ({ page }) => {
    await openLessonBoard(page, 'bookstore');
    await setQuery(page, 'select b.title, a.name from book b join author a on b.author_id = a.author_id');
    await expect(page.getByTestId('stage-chip').filter({ hasText: 'JOIN' })).toBeVisible();
    // подпись последней фазы
    await expect(page.getByTestId('stage-caption')).toContainText('9 пар');
    // сцена сыграла до конца: автоплей 2x, 7 фаз * ~700 мс
    await expect(page.getByTestId('overlay-scene')).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveText('9');
    await expect(page.getByTestId('overlay-scene')).toHaveScreenshot('inner-join-final.png', { maxDiffPixelRatio: 0.02 });
  });

  test('LEFT JOIN: NULL-плашки в строках без пары', async ({ page }) => {
    await openLessonBoard(page, 'bookstore');
    await setQuery(page, 'select b.title, a.name from book b left join author a on b.author_id = a.author_id');
    await expect(page.getByTestId('stage-caption')).toContainText('11');
    // «Простой Python» и «Изучаем Python» без автора: NULL в правой половине
    await expect(page.getByTestId('null-cell')).toHaveCount(2);
    await expect(page.getByTestId('overlay-scene')).toHaveScreenshot('left-join-final.png', { maxDiffPixelRatio: 0.02 });
  });

  test('FULL JOIN: NULL с обеих сторон, 12 строк', async ({ page }) => {
    await openLessonBoard(page, 'bookstore');
    await setQuery(page, 'select b.title, a.name from book b full join author a on b.author_id = a.author_id');
    await expect(page.getByTestId('null-cell').first()).toBeVisible();
    await expect(page.getByTestId('result-count')).toHaveText('12');
  });

  test('GROUP BY: чипы FROM, GROUP BY, SELECT; строки-группы', async ({ page }) => {
    await openLessonBoard(page, 'bookstore');
    await setQuery(page, 'select author_id, count(*) from book group by author_id');
    const chips = page.getByTestId('stage-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText('FROM');
    await expect(chips.nth(1)).toHaveText('GROUP BY');
    await expect(chips.nth(2)).toHaveText('SELECT');
    await expect(page.getByTestId('stage-caption')).toContainText('6 групп');
    await expect(page.getByTestId('result-count')).toHaveText('6');
    await expect(page.getByTestId('overlay-scene')).toHaveScreenshot('group-by-final.png', { maxDiffPixelRatio: 0.02 });
  });
});
```

  Хелперы `openLessonBoard(page, dataset)` и `setQuery(page, sql)` - если Ф6 их уже породил, импортировать; иначе вынести общий код из `tests/e2e/overlay.spec.ts` в `tests/e2e/helpers.ts` первым шагом (отдельный мини-коммит или в составе этой задачи). Селекторы `stage-chip`, `stage-caption`, `overlay-scene`, `result-count`, `null-cell` - согласовать с фактически созданными в Ф6; если имя отличается, использовать актуальное, тесты в этой задаче не меняют разметку Ф6, кроме `null-cell` (NULL-плашка - рендер GhostTable Ф6, `data-testid="null-cell"` добавить в нем, если ещё нет - это мелкая правка рендера, не отклонение).

- [ ] **Шаг 3. Запуск:** `pnpm e2e -- tests/e2e/join-group.spec.ts`. Ожидаемо: падения - сцен JOIN/GROUP BY нет (ANIMATORS Ф6 не знает `join`/`group`, стадий нет - чипы не появляются). Это и есть красный тест.

- [ ] **Шаг 4. Реализация.** Основная работа уже сделана задачами 1-11: пайплайн отдаёт стадии, аниматоры зарегистрированы. Здесь:
  - убедиться, что `animators/index.ts` содержит `join: joinAnimator` и `group: groupAnimator`;
  - если сцена не проигрывается из-за падения трассы в браузере (а в Node зелёная) - смотреть `fallbackReason` в подписи плеера; чаще всего это расхождение `clauseRanges` или потеря фрагмента FROM в депарсере;
  - скриншоты: первый прогон упадёт с отсутствующими снапшотами - Playwright создаст их (`--update-snapshots`), затем глазами проверить кадры: таблицы-призраки, линии пар, NULL-плашки, стопки групп. Кривой скриншот - править аниматор, не снапшот.

- [ ] **Шаг 5. Запуск полного набора:** `pnpm e2e` - сцены Ф5/Ф6 не сломаны, новые зелёные. Затем `pnpm check`.

- [ ] **Шаг 6. Трекер:**

```bash
sed -i '' "s|🔄 ([0-9-]*) \*\*P7\.16\*\*|✅ ($(date +%F)) **P7.16**|" docs/PROGRESS.md
```

- [ ] **Шаг 7. Коммит:**

```bash
pnpm format && pnpm check
git add tests/e2e/join-group.spec.ts tests/e2e/helpers.ts docs/PROGRESS.md
git commit -m "test(e2e): сцены JOIN и GROUP BY со скриншотами конечных состояний

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Покрытие пунктов трекера

- P7.2: задача 1 (левоглубокое дерево, пары, клоны, строки без пары).
- P7.3: задачи 1-2 (inner, left - задача 1; right, full, cross - задача 2).
- P7.4: задача 3 (цепочка 4 таблиц, промежуточные join-стадии). P7.5: задача 3 (SELF JOIN).
- P7.6: задача 4 (USING и NATURAL со слиянием колонок-ключей).
- P7.7: задача 5 (аниматор INNER). P7.8: задача 6 (LEFT / RIGHT / FULL). P7.9: задача 7 (CROSS).
- P7.10: задача 8 (group + агрегаты, включая без GROUP BY). P7.11: задача 9 (HAVING).
- P7.12 и P7.13: задача 10 (аниматор GROUP BY и агрегат без GROUP BY, count(*) vs count(col)).
- P7.14: задача 11 (фокус и сцена 42803). P7.15: задача 12 (фаззер + golden Ф7). P7.16: задача 13 (E2E со скриншотами).
- P7.1 (согласование плана) этот план не закрывает.

## Отклонения от контрактов

Отклонений, требующих правки `docs/superpowers/plans/2026-10-08-00-contracts.md`, нет: все типы стадий (`join`, `filter` c `having`, `group`), поля `GhostTable` / `GhostRow` / `Decoration` (`bracket`, `counter`, `pair-line`, `null-filled`) уже описаны контрактами Ф5/Ф6. Уточняются только трактовки полей, они фиксируются кодом и тестами:

1. `Stage.join.pairs` содержит и строки без пары: `[left, null]` для left/full, `[null, right]` для right/full (контракт не описывал способ кодирования). Строки без пары читаются прямо из NULL-ctid lineage, а не «сравнением со scan», как предлагала спека 5.6.
2. `Stage.join.onColumns` - квалифицированные `'alias.column'` из ON-условия в порядке вхождения; для USING/NATURAL пуст, ключи описаны в `usingColumns`.
3. `Stage.group.aggregates` - тексты `sqlOf` агрегатных выражений из SELECT и HAVING; `output` стадии - ключи и агрегаты, строки - группы с ключами `g:N` из `rowkey.groupKey` (контрактный).
4. Whitelist расширяет внутренний набор `Feature` значениями `join-right`, `join-full`, `join-cross` - файл `whitelist.ts` в контрактах описан только сигнатурой `unsupportedReason`, внутренности свободны.
5. `GOLDEN_F7` в `tests/tracer/golden.queries.ts` - отдельный экспорт рядом с `GOLDEN` (Ф5), `golden.test.ts` гоняет оба. Формат записи совпадает с контрактом плана Ф5.
