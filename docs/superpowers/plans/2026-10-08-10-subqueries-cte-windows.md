# Ф10 «Подзапросы, множества, CTE, окна»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используй superpowers:subagent-driven-development (рекомендуемый) или superpowers:executing-plans, чтобы выполнять план задача за задачей. Шаги размечены чекбоксами (`- [ ]`).

**Goal:** все конструкции глав 4, 6-9 визуализируются: setop, materialize, recursion, window, подзапросы (скалярный, IN, коррелированный, LATERAL, EXISTS/NOT EXISTS), CASE WHEN, ROLLUP/CUBE/GROUPING SETS, FILTER. Уроки этих глав ✅, фаззер расширен на новые конструкции. Что трассировщик не тянет - честно `final-only` с причиной.

**Architecture:** как в Ф5/Ф7: Postgres считает сам, мы смотрим. Ветвь setop и тело CTE/подзапроса трассируются рекурсивно тем же `traceStatement`/`runSelect` и становятся дочерними `Trace` внутри стадии. Материализация - через TEMP TABLE внутри транзакции превью (после ROLLBACK исчезает сама). Окна и коррелированные подзапросы - пробами с `ctid`, N-прогонов ограничено `maxRows` и лимитом выборки `N=3` (спека 4: первые 3 подробно, остальные быстро или итог). Волатильность, глубина и лимит итераций - причины `final-only`, неверной анимации не бывает: финальная сверка с эталоном обязательна.

**Tech Stack:** без новых пакетов: TypeScript strict, `@electric-sql/pglite@0.5.8`, `libpg-query@18.1.5`, `pgsql-deparser@18.3.10`, Vitest 5 (проект `node`), Playwright для e2e-сцен.

**Spec:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, разделы 4 («Подзапросы, множества, CTE», «Оконные функции», «Агрегация»), 5.6, 5.7, 8, 9, 6.2 (events), 6.3 (уроки L4.4-L9.5). Контракты: разделы 4-6, 8-10, 12, 13.

---

## Глобальные ограничения

- Зависимости: Ф2 (`DbClient`, `withDataset`, `inPreview`), Ф4 (`initParser`, `parseSql`, `sqlOf`, `deparse`), Ф5 (пайплайн `SELECT_PIPELINE`, `createProber`, `verify`, `whitelist`, `rowkey`), Ф6 (реестр аниматоров), Ф7 (стадии `join`, `group`). Ф10 начинается, когда они ✅.
- `features/tracer` не знает про React. Вход `ParsedStatement` + `DbClient`, выход `Trace`. Вызов всегда внутри открытой транзакции превью; `BEGIN`/`COMMIT`/`ROLLBACK` трассировщик не выполняет.
- Каждая проба под `SAVEPOINT`, `signal.throwIfAborted()` перед каждой пробой, строковые пробы под `LIMIT maxRows + 1`.
- Целый `SelectStmt` не депарсим (Ф5: WITH TIES). Пробы собираются из фрагментов AST через `sqlOf`.
- TEMP-таблицы проб создаются со свежими именами `__vs_m<N>` / `__vs_r<N>` (счётчик на трассу, чтобы вложенные трассы не конфликтовали). После ROLLBACK они исчезают сами.
- Рекурсия: лимит итераций 50. Превышен - `final-only` с причиной «рекурсия глубже 50 итераций».
- Коррелированный подзапрос: если внешних строк больше `maxRows`, в `samples` идут первые 3, стадии после подзапроса получают `final-only`... нет: трасса целиком уходит в `final-only` с причиной «коррелированный подзапрос на N строк». Исключение - LATERAL, где проба одна на весь запрос с `ctid` внешней таблицы.
- Комментарии в коде на русском, идентификаторы на английских, подписи в UI на русском. Длинное тире не используем.
- Перед каждым коммитом: `pnpm format`, `pnpm check` зелёный. Коммит с ЯВНЫМИ путями (НЕ `git add -A`). Последняя строка коммита: ``.
- Трекер: перед началом пункта ⬜ → 🔄 с датой; после проверки 🔄 → ✅ с датой, в том же коммите.

## Review Focus

1. **Мультимножественная семантика EXCEPT ALL / INTERSECT ALL.** `except all` вычитает по одному вхождению, не все дубли. Тест: `select 1 union all select 1` except all `select 1` → 1 строка. Считать в JS по канону с кратностями (Map canon → count), не Set.
2. **Рекурсивный CTE и порядок итераций.** Прогон через TEMP-таблицу обязан совпадать с `WITH RECURSIVE` Postgres по множеству строк (порядок внутри итераций не важен, важно множество). Тест: дерево employee - 4 уровня, 8 строк, итерации размерами 1/2/3/1/0.
3. **Рамка окна и «ничьи».** Строки с равными `PARTITION BY + ORDER BY` ключами: рамка `ROWS` отсчитывает физические строки, `RANGE` - группы. Проба обязана вернуть строки в порядке `(partition keys, order keys, ctid)`. Тест: рамка `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW` при двух равных суммах.
4. **NOT IN с NULL.** `author_id not in (select author_id from book)` возвращает 0 строк (в списке есть NULL), хотя anti-join даёт 1. Стадия `subquery mode:'in'` обязана получить вердикты `null` для всех строк, сверка с эталоном ловит расхождение, если налажали. Тест обязательный.
5. **Двойное выполнение volatile в подзапросе.** Эталон и пробы подзапроса с `random()` расходятся - трасса обязана уйти в `final-only` по признаку volatile (наследование `VOLATILE` из whitelist Ф5). Тест: `select (select random())`.

## Отклонения от контрактов

Задача 1 вносит их в контракты отдельным коммитом `docs(contracts): ...`:

1. `Stage.subquery` получает поле `limit3: boolean` - «первые 3 подробно, остальные из итога» (спека 4, коррелированный подзапрос). Для mode `'correlated'` при `limit3 = true` трасса остаётся `full`, но `samples` длинной 3, а стадии после подзапроса помечаются `compressed`.
2. `Stage.window` получает `functions: string[]` (имена оконных функций из SELECT) и `orderKeys: string[]`.
3. `Stage.group` расширяется полем `groupingSets?: string[][]` (ROLLUP/CUBE/GROUPING SETS: группы для каждого набора, спека 4).
4. Новые файлы: `src/features/tracer/setop/setop.ts`, `materialize/materialize.ts`, `recursion/recursion.ts`, `window/window.ts`, `subquery/subquery.ts`, `subquery/correlated.ts`, `tests/helpers/events.ts`, `tests/tracer/golden-f10.queries.ts`.
5. Whitelist: внутренние признаки `setop`, `cte`, `cte-recursive`, `window`, `subquery-scalar`, `subquery-in`, `subquery-correlated`, `subquery-lateral`, `setop-all` - файл `whitelist.ts` свободен внутри, контракт описывает только `unsupportedReason`.
6. Датасет `events` в контракты, раздел «Датасеты»: `content/datasets/events.sql`, порядок загрузки - после `bookstore` (внешние ключи на `orders`).

## Карта файлов

```
content/datasets/events.sql                     события заказов для окон (задача 1)
src/features/tracer/setop/setop.ts (+.test.ts)  стадии setop (задача 2)
src/features/tracer/materialize/materialize.ts  TEMP-материализация CTE/подзапроса (задача 3)
src/features/tracer/recursion/recursion.ts      WITH RECURSIVE (задача 4)
src/features/tracer/window/window.ts            оконные функции (задача 5)
src/features/tracer/subquery/subquery.ts        скалярный, IN, EXISTS (задача 6)
src/features/tracer/subquery/correlated.ts      коррелированный, LATERAL (задача 7)
src/features/tracer/select/case.ts              CASE WHEN в project (задача 8)
src/features/tracer/select/grouping.ts          ROLLUP/CUBE/GROUPING SETS, FILTER (задача 8)
src/features/tracer/fuzz/fuzz-f10.ts            генератор новых конструкций (задача 9)
src/features/overlay/animators/setop.ts         аниматоры setop (задача 10)
src/features/overlay/animators/materialize.ts   пунктирная таблица (задача 10)
src/features/overlay/animators/recursion.ts     слои итераций (задача 10)
src/features/overlay/animators/window.ts        партиции, рамка, ранги, lag/lead (задача 10)
src/features/overlay/animators/subquery.ts      мини-сцены (задача 10)
src/features/overlay/animators/case.ts          ветки CASE, ON vs WHERE, FILTER (задача 10)
content/lessons/04-operators/*.mdx              уроки L4.4, L4.8, L4.9, L4.10 (задачи 12-13)
content/lessons/06-joins/*.mdx                  L6.1, L6.4-L6.13 (задача 14)
content/lessons/07-aggregation/*.mdx            L7.4, L7.5 (задача 15)
content/lessons/08-subqueries/*.mdx             L8.1-L8.8 (задача 16)
content/lessons/09-windows/*.mdx                L9.1-L9.5 (задача 17)
tests/tracer/golden-f10.queries.ts (+.test.ts)  golden-сверка фазы (задача 18)
```

## Числа-якоря по датасету bookstore (проверены вручную, арбитр - pnpm test:content)

author 6 (1 без книг), book 11 (2 без автора: «Простой Python» id 10, «Изучаем Python» id 11; 1 без цены: «Остров» id 7), book_category 6 (1 без книг: «Фотография» id 5), customer 6 (1 без заказов: Елена), orders 8, order_item 15, employee 8 (дерево: уровни 1/2/2/2/1... итерации рекурсии 1→2→3→1→0; ничья зарплат 70000×2), review 10. Суммы заказов: o1 1730, o2 2400, o3 1780, o4 1990, o5 1400, o6 4390, o7 2110, o8 3620.

---

## Задача 1. Контракты и датасет events (P10.2)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-08-00-contracts.md`, `docs/PROGRESS.md`
- Create: `content/datasets/events.sql`, `tests/helpers/events.ts`

**Interfaces:**
- Produces: `content/datasets/events.sql` (события заказов: временные ряды для окон), `eventsDataset: string` в `tests/helpers/events.ts`.

- [ ] **Шаг 1. Трекер и контракты.** P10.2 ⬜ → 🔄. Внести отклонения 1-6 из шапки в контракты (разделы 6, «Датасеты»). Коммит `docs(contracts): ...` с явными путями.

- [ ] **Шаг 2. Датасет.** `content/datasets/events.sql`:

```sql
-- Датасет events: события заказов. Временные ряды для оконных функций.
-- Особенности: у заказа 3 две строки с ОДИНАКОВЫМ happened_at (рамка RANGE vs ROWS),
-- у заказа 4 нет платежа (отменён), у заказа 2 одно событие (lag/lead дают NULL).

create table event (
  event_id bigint generated always as identity primary key,
  order_id bigint not null references orders (order_id) on delete cascade,
  kind text not null check (kind in ('created', 'paid', 'shipped', 'cancelled', 'returned')),
  amount numeric(10, 2),
  happened_at timestamptz not null
);

insert into event (order_id, kind, amount, happened_at) values
  (1, 'created',   null,  '2024-03-01 10:00:00+03'),
  (1, 'paid',      1730.00, '2024-03-01 10:05:00+03'),
  (1, 'shipped',   null,  '2024-03-16 09:00:00+03'),
  (2, 'created',   null,  '2024-03-20 11:00:00+03'),
  (2, 'paid',      2400.00, '2024-03-20 11:02:00+03'),
  (3, 'created',   null,  '2024-04-02 23:50:00+03'),
  (3, 'paid',      1780.00, '2024-04-02 23:55:00+03'),
  (3, 'cancelled', null,  '2024-04-02 23:55:00+03'),   -- особое: та же секунда, что платёж (RANGE vs ROWS)
  (4, 'created',   null,  '2024-04-05 09:00:00+03'),
  (4, 'cancelled', null,  '2024-04-05 10:00:00+03'),   -- особое: заказ без paid
  (5, 'created',   null,  '2024-04-10 15:00:00+03'),
  (5, 'paid',      1400.00, '2024-04-10 15:01:00+03'),
  (5, 'shipped',   null,  '2024-04-12 12:00:00+03'),
  (6, 'created',   null,  '2024-05-01 00:10:00+03'),
  (6, 'paid',      4390.00, '2024-05-01 00:12:00+03'),
  (7, 'created',   null,  '2024-05-03 11:00:00+03'),
  (7, 'paid',      2110.00, '2024-05-03 11:01:00+03'),
  (7, 'shipped',   null,  '2024-05-04 10:00:00+03'),
  (7, 'returned',  null,  '2024-05-06 18:00:00+03'),   -- особое: возврат после доставки
  (8, 'created',   null,  '2024-05-03 12:00:00+03'),
  (8, 'paid',      3620.00, '2024-05-03 12:03:00+03');

analyze;
```

- [ ] **Шаг 3. Тест датасета.** В `tests/helpers/events.ts` - экспорт `eventsDataset` (конкатенация `bookstore.sql` + `events.sql`, как загружает `datasets.ts` Ф2). Тест в `tests/tracer/events-dataset.test.ts`: загрузить, `select count(*) from event` = 21, `select count(*) from event where kind = 'paid'` = 7, `select order_id, count(*) from event group by order_id order by order_id` = 1:3, 2:2, 3:3, 4:2, 5:3, 6:2, 7:4, 8:2. Прогнать, ✅, коммит `feat(datasets): events для оконных функций (P10.2)`.

## Задача 2. Стадия setop (P10.3)

**Files:**
- Create: `src/features/tracer/setop/setop.ts`, `setop.test.ts`
- Modify: `src/features/tracer/trace.ts` (маршрутизация SelectStmt с `op`), `whitelist.ts`

**Interfaces:**
- Consumes: `runSelect` (Ф5), `traceStatement`, `createProber`, `verify.canon`.
- Produces: `setopStage(left: Trace, right: Trace, op: SetopOp): Stage & { kind: 'setop' }` - вычисляет строки результата из выходов ветвей по канону с кратностями.

- [ ] **Шаг 1. Падающий тест.** `select name from author where country = 'Россия' union select name from author where born_year < 1830` - стадия `setop`, ветви - дочерние трассы, 6 строк (5 Россия + Верн). `except all`: `(select 4 union all select 4) except all select 4` - 1 строка. `intersect`: книги фантастика intersect приключения - 2 («Остров», «Путешествие»). Ожидания по стадиям: `kind`, `op`, число строк.
- [ ] **Шаг 2. Реализация.** `trace.ts`: если у `SelectStmt` есть `op` (`SETOP_NONE` нет) - обе ветви (`larg`/`rarg`) трассируются рекурсивно `traceSelect`, затем `setopStage`. С UNION/INTERSECT/EXCEPT (без ALL) - кратности схлопываются, с ALL - вычитаются/пересекаются по одной. Канон строки - `verify.rowCanon` из Ф5. `whitelist`: `setop-all` допустим; глубина вложенности setop > 3 → `final-only`.
- [ ] **Шаг 3. Сверка и коммит.** Golden-строки в `golden-f10.queries.ts` (задача 18 соберёт). `pnpm check`, ✅ P10.3, коммит `feat(tracer): стадия setop с кратностями (P10.3)`.

## Задача 3. Стадия materialize (P10.4)

**Files:**
- Create: `src/features/tracer/materialize/materialize.ts`, `materialize.test.ts`
- Modify: `src/features/tracer/trace.ts`, `select/context.ts`

**Interfaces:**
- Produces: `materializeInto(db: DbClient, inner: SelectStmt, name: string): Promise<Relation>` - пишет тело во временную таблицу `__vs_m<N>`, читает её с `ctid`; `materializeStage(name: string, inner: Trace)`.

- [ ] **Шаг 1. Падающий тест.** `with python_books as (select book_id, title from book where tags @> '{python}') select count(*) from python_books` - стадия `materialize` с `name: 'python_books'`, дочерняя трасса, дальше `scan` по `__vs_m0` (алиас `python_books`), 3 строки в промежутке.
- [ ] **Шаг 2. Реализация.** CTE из `withClause` (не recursive): `create temp table __vs_m0 as <sqlOf(cte)>`, затем `select ctid, * from __vs_m0` даёт relation со свежими ctid (lineage внутренняя, ссылается на исходные таблицы через дочернюю трассу). Подзапрос в FROM без alias-CTE - та же схема, имя `__vs_from0`. `select ... from (select ...) as x` читает `__vs_m0`. Внешний пайплайн идёт дальше как обычный SELECT по этой таблице.
- [ ] **Шаг 3. `MATERIALIZED`/`NOT MATERIALIZED`.** По умолчанию PG18 материализует простые CTE один раз; при `not materialized` в трассе ставится `mode: 'full'`, но без TEMP-стадии, подзапрос инлайнится в пробу P (через `sqlOf` в тексте пробы). Пометка `fallbackReason` не нужна. Тест: `with a as not materialized (...)`.
- [ ] **Шаг 4. Сверка, коммит.** `pnpm check`, ✅ P10.4, коммит `feat(tracer): материализация CTE и подзапросов из FROM через TEMP (P10.4)`.

## Задача 4. Стадия recursion (P10.5)

**Files:**
- Create: `src/features/tracer/recursion/recursion.ts`, `recursion.test.ts`

**Interfaces:**
- Produces: `recursiveStage(name: string, anchor: SelectStmt, step: SelectStmt, db: DbClient): Promise<Stage & { kind: 'recursion' }>` - итерации через TEMP-таблицу `__vs_r<N>`.

- [ ] **Шаг 1. Падающий тест.** Дерево employee: `with recursive t as (select employee_id, name, manager_id from employee where manager_id is null union all select e.employee_id, e.name, e.manager_id from employee e join t on e.manager_id = t.employee_id) select * from t` - стадия `recursion`, `iterations` = 5 отношений (якорь 1 строка, потом 2, 3, 1... стоп: уровни 1,2,4,8 сотрудников → 1/2/4/1 и 5-я итерация 0 строк... сверить: Ольга(1), Павел+Светлана(2), Дмитрий+Алексей+Наталья+Игорь(4), Татьяна(1), пусто). Итого `iterations.length` = 5, строк 8.
- [ ] **Шаг 2. Реализация.** `create temp table __vs_r0 as <anchor>`; цикл: `insert into __vs_r0 <step с t = __vs_r0> returning *` - накопленные строки итерации; пустая итерация или 50-я - стоп. Отношение каждой итерации - строки `returning` (свежие ctid для lineage внутри итерации). `UNION` (не ALL) - дедуп через `distinct` в insert... нет: вставлять только новые строки (`where not exists` по канону), так семантика UNION в рекурсии. Волатильный шаг → `final-only`.
- [ ] **Шаг 3. Сверка, коммит.** Сверка итога рекурсии с эталоном (множество строк). `pnpm check`, ✅ P10.5, коммит `feat(tracer): рекурсивный CTE итерациями через TEMP (P10.5)`.

## Задача 5. Стадия window (P10.6)

**Files:**
- Create: `src/features/tracer/window/window.ts`, `window.test.ts`
- Modify: `select/pipeline.ts` (шаг `window` после `group`/до `project`)

**Interfaces:**
- Produces: `windowStage(ctx: SelectCtx): Stage & { kind: 'window' }` - из пробы `select <оконные выражения> over w, ctid-колонки from <from> ...`, порядок `(partition keys, order keys, ctid)`.

- [ ] **Шаг 1. Падающий тест.** `select name, salary, row_number() over (partition by position order by salary) from employee` - `partitions` по `position`, вычисленные значения в `computed`. lag/lead на events: `select kind, lag(kind) over (order by happened_at) from event where order_id = 3` - 3 строки, lag первой NULL. Накопительный итог: `sum(amount) over (order by happened_at)` по order 7.
- [ ] **Шаг 2. Реализация.** Шаг пайплайна `window`: если в SELECT есть `FuncCall` с `over` (признак - поле `over` в AST) - проба `select <выражения с over>, __vs_ctid0, ... from <from> where ... group by ...` с дозаписью ключей порядка. `partitions` - группы строк по значениям `PARTITION BY` (ключ группы = канон значений), `computed` - имена колонок результата, `functions` - имена функций, `frame` - текст рамки из AST (`frameOptions` + границ), если есть. Рамка в JS не пересчитывается: значения берутся из пробы (Postgres сам учёл рамку), JS только описывает её для аниматора.
- [ ] **Шаг 3. `RANGE`/группы и «ничьи».** Тест events order 3: рамка `RANGE BETWEEN ...` и две строки с равным `happened_at` - значения из пробы совпадают с эталоном, порядок строк пробы - `(keys, ctid)` (как Ф5, проба P). Никакой своей математики окон: только интерпретация для сцены.
- [ ] **Шаг 4. Сверка, коммит.** `pnpm check`, ✅ P10.6, коммит `feat(tracer): стадия window из пробы с over (P10.6)`.

## Задача 6. Скалярный, IN и EXISTS как вложенные трассы (P10.7, P10.9)

**Files:**
- Create: `src/features/tracer/subquery/subquery.ts`, `subquery.test.ts`
- Modify: `whitelist.ts`, `select/filter.ts` (IN/EXISTS в WHERE)

**Interfaces:**
- Produces: `scalarStage(inner: Trace, value: unknown)`, `inStage(inner: Trace, verdicts: Record<RowKey, true | false | null>)`, `existsStage(inner: Trace, verdicts: ...)`.

- [ ] **Шаг 1. Падающие тесты.** Скалярный: `select title, (select max(price) from book) as max_price from book` - стадия `subquery mode:'scalar'` с дочерней трассой (3 стадии), значение 3200 в каждой строке. IN: `where category_id in (select category_id from book_category where parent_id is null)` - вердикты по строкам book, 8 строк (категории 1,2,5: книги 1,2,3,4,5 нет... сверить по test:content). NOT IN с NULL (Review Focus 4): `where author_id not in (select author_id from book)` - все вердикты `null`, итог 0 строк, трасса `full` (вердикты честные). EXISTS: `where exists (select 1 from review r where r.book_id = book.book_id)` - semi: 7 книг с отзывами.
- [ ] **Шаг 2. Реализация.** Скалярный подзапрос в SELECT: внутренний `SelectStmt` трассируется в дочернюю трассу, значение - единственная ячейка пробы внутреннего запроса; подстановка в внешний - строкой в пробе P внешнего (значение уже там, Postgres сам его подставил). IN: проба `select __vs_verdict = (<inner>) ... ` - нет: вердикты через пробу `select b.ctid, b.category_id in (select ...) as v from book b` (PG вычислит in с NULL-семантикой). NOT IN - та же проба, `not v`. EXISTS: `select b.ctid, exists(select ...) as v from book b`. Дочерняя трасса - отдельный `traceSelect` внутреннего AST (для сцены).
- [ ] **Шаг 3. Сверка, коммит.** `pnpm check`, ✅ P10.7 (часть), коммит `feat(tracer): скалярный, IN и EXISTS вложенными трассами (P10.7)`.

## Задача 7. Коррелированные и LATERAL (P10.8)

**Files:**
- Create: `src/features/tracer/subquery/correlated.ts`, `correlated.test.ts`

**Interfaces:**
- Produces: `correlatedStage(outer: Relation, inner: SelectStmt, db: DbClient): Promise<Stage>` - `samples` по 3 внешним строкам (limit3), либо вся трасса `final-only`.

- [ ] **Шаг 1. Падающий тест.** Классика: `select title from book b where price > (select avg(price) from book where author_id = b.author_id)` - 7 строк (книги дороже средней по своему автору; у авторов без книг... авторы без книг не в book, подзапрос NULL → comparison null → отвал). Первые 3 сэмпла: `outer` RowKey книги, `inner` Trace с одной стадией (avg). При `maxRows < внешних строк` - трасса `final-only`, причина «коррелированный подзапрос, строк больше лимита».
- [ ] **Шаг 2. Реализация.** Для каждой внешней строки (первые `min(3, внешних)`) - проба внутреннего запроса с подставленными значениями внешних колонок (подстановка через `sqlOf` с литералами: строковые в кавычках через `QuoteUtils`). Полный результат берётся из эталона. Если конструкция не сворачивается в одну пробу (внешних строк > maxRows) - `final-only`. EXISTS-коррелированный (урок 6.10/6.11) уже закрыт задачей 6. NOT IN с NULL - задача 6.
- [ ] **Шаг 3. LATERAL.** `select a.name, t.title from author a, lateral (select title from book b where b.author_id = a.author_id order by price desc limit 1) t` - проба одна: `select a.name, t.title, a.ctid, t.__ctid from author a, lateral (...) t` (ctid внутренней таблицы через подзапрос в FROM... если ctid недоступен - `limit3` со сэмплами, как коррелированный). Стадия `subquery mode:'lateral'`, пары внешняя-внутренняя по строкам пробы. Тест: 5 авторов с книгами, у каждого топ-книга.
- [ ] **Шаг 4. Сверка, коммит.** `pnpm check`, ✅ P10.8, коммит `feat(tracer): коррелированные подзапросы и LATERAL (P10.8)`.

## Задача 8. CASE WHEN, ROLLUP/CUBE/GROUPING SETS, FILTER (часть P10.10, P10.11)

**Files:**
- Create: `src/features/tracer/select/case.ts`, `select/grouping.ts` (+тесты)
- Modify: `select/project.ts`, `select/group.ts`

- [ ] **Шаг 1. CASE WHEN.** `select title, case when price < 500 then 'дёшево' when price < 1000 then 'средне' else 'дорого' end as bucket from book` - стадия `project` помечает колонку `computed` с `branches: string[]` (тексты WHEN/ELSE через `sqlOf`) в `Stage.project` (поле добавить в контракты заданием 1 - отклонение 2 группы... если нет - добавить сюда). Значения из пробы P. Тест: 11 строк, корзины 3/4/3, «Остров» (null price) → 'дорого' (else).
- [ ] **Шаг 2. ROLLUP/CUBE/GROUPING SETS.** `select coalesce(name, 'ИТОГО'), count(*) from book b join book_category c using (category_id) group by rollup(name)` - стадия `group` с `groupingSets`: группы по каждой категории + тотал. Проба: сам запрос (эталон) + разбор строк: строки с NULL-ключами в rollup - групповые уровни, `grouping()` различает NULL-данные и NULL-ролап (в пробе добавить `grouping(name)` как техническую колонку). Тест: rollup по category_id книги - 4 группы + total 9 (2 без категории не в join... сверить).
- [ ] **Шаг 3. FILTER.** `select count(*) filter (where rating >= 5) as great, count(*) from review` - стадия `group` (агрегат без GROUP BY), `aggregates` с текстом FILTER, значения из пробы. Тест: 5 и 10.
- [ ] **Шаг 4. ON vs WHERE.** Не стадия, а два запроса урока 6.9: трассы обоих, сцены рядом (аниматор, задача 10). Тестов трассировщика не требует - покрыто e2e урока.
- [ ] **Шаг 5. Сверка, коммит.** `pnpm check`, коммит `feat(tracer): CASE-ветки, rollup/cube/grouping sets и FILTER (P10.10 частично)`.

## Задача 9. Фаззер на новые конструкции (P10.12)

**Files:**
- Create: `src/features/tracer/fuzz/fuzz-f10.ts` (продолжение генератора Ф7)
- Test: `tests/tracer/fuzz-f10.test.ts` (seed-детерминированный)

- [ ] **Шаг 1. Генератор.** Расширить генератор Ф7 (или отдельный `fuzz-f10.ts` с тем же интерфейсом): случайные комбинации `UNION [ALL] / INTERSECT / EXCEPT`, CTE (1-2, в т.ч. рекурсивный по employee), подзапросы в WHERE (`IN`, `NOT IN`, `EXISTS`, скалярный), окна (`row_number`, `rank`, `sum over`), `LATERAL` top-1, `CASE`. 200 сид-запросов.
- [ ] **Шаг 2. Свойство.** Для каждого запроса: `traceStatement` либо `mode: 'full'` и финал совпадает с прямым выполнением (`sameResult`), либо `mode: 'final-only'` с непустой `fallbackReason`. Любое расхождение при `full` - баг трассировщика, не фаззера.
- [ ] **Шаг 3. Прогон, коммит.** 200 сидов зелёные (падения чинить в трассировщике, не в фаззере). `pnpm check`, ✅ P10.12, коммит `test(tracer): фаззер подзапросов, CTE, setop и окон (P10.12)`.

## Задача 10. Аниматоры новых стадий (P10.10, P10.11)

**Files:**
- Create: `src/features/overlay/animators/setop.ts`, `materialize.ts`, `recursion.ts`, `window.ts`, `subquery.ts`, `case.ts` (+dom-тесты)

**Interfaces:**
- Consumes: реестр аниматоров Ф6 (`registerAnimator(kind, ...)`), `GhostTable`/`GhostRow`/`Decoration` из Ф6.
- Produces: аниматоры стадий `setop`, `materialize`, `recursion`, `window`, `subquery`.

- [ ] **Шаг 1. setop (спека 4).** UNION ALL: ветви встают друг под другом, строки верхней переезжают вниз. UNION: плюс схлопывание дублей (как distinct в Ф5/Ф6). INTERSECT: пары-близнецы соединяются линией, непарные уводятся. EXCEPT: из верхней вычёркиваются строки, найденные в нижней. Dom-тест: кадры для union/except на двух ветвях по 3 строки.
- [ ] **Шаг 2. materialize.** Тело CTE/подзапроса проигрывается мини-сценой (дочерняя трасса), результат «застывает» в таблицу с пунктирной рамкой и именем CTE, дальше участвует как обычная (reuse аниматора scan).
- [ ] **Шаг 3. recursion.** Итерации слоями: якорь - верхний слой, каждый шаг - новый слой ниже, строки нового слоя прилетают из исходной таблицы, связь с родителем стрелкой. 50 слоёв не бывает (лимит), но 10+ - уплотнение (первые 3 слоя подробно, слои 4+ схлопываются в счётчик).
- [ ] **Шаг 4. window (спека 4).** PARTITION BY: строки окрашиваются по партициям (палитра групп из Ф1), не схлопываются. Рамка: по партиции едет скобка-рамка (`ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`), новая колонка заполняется построчно. row_number/rank/dense_rank: номера проставляются по очереди, ничьи подсвечены. lag/lead: стрелка от соседней строки к текущей.
- [ ] **Шаг 5. subquery.** Скалярный: маленькая сцена в рамке схлопывается в одно значение, летит в ячейку. Коррелированный: первые 3 внешние строки по очереди запускают мини-сцену (медленно), остальные - быстро счётчиком. IN/EXISTS: вердикты на внешних строках (зелёная/красная подсветка), semi/anti: anti-строки отваливаются.
- [ ] **Шаг 6. case.** CASE: у каждой строки подсвечивается сработавшая ветка (ветки подписаны). ON vs WHERE: две сцены рядом (две мини-доски в оверлее), синхронный шаг, расхождение на строке-примере. FILTER: часть строк проходит в агрегат, часть «мимо счётчика» серым.
- [ ] **Шаг 7. Сверка, коммит.** Dom-тесты на кадры каждого аниматора (как в Ф6). `pnpm check`, ✅ P10.10 и P10.11, коммит `feat(overlay): аниматоры setop, materialize, recursion, window, подзапросов и CASE (P10.10, P10.11)`.

## Задача 11. E2E сцен новых стадий

**Files:**
- Create: `tests/e2e/f10-scenes.spec.ts`

- [ ] **Шаг 1.** Playwright: урок 8.6 (CTE) - сцена materialize, пунктирная рамка с именем CTE; урок 8.7 (рекурсивный CTE) - слои; урок 9.4 (рамка) - скобка едет по партиции. Селекторы по aria-меткам из Ф6. Скриншоты конечных состояний (как P7.16).
- [ ] **Шаг 2. Коммит.** `pnpm e2e` зелёный, коммит `test(e2e): сцены CTE, рекурсии и окон (Ф10)`.

## Задача 12. Конвейер уроков Ф10

Общие правила для задач 13-17 (как в Ф8, план `2026-10-08-08-mvp-content.md`):

- Каждый урок: MDX по гайду `docs/content-style.md`, свой разговорный текст, сквозной датасет bookstore/events, числа-якоря сверены с `pnpm test:content`.
- Порядок шагов в каждой задаче урока: (1) трекер ⬜ → 🔄; (2) создать MDX; (3) `pnpm test:content` зелёный (числа и `expect`); (4) посмотреть сцены глазами в dev; (5) 🔄 → ✅, коммит `feat(lessons): урок <номер> <тема>` с явными путями.
- `trace="final-only"` допустим только с причиной в `Заметка:` трекера (конструкции, которых трассировщик не тянет).
- Frontmatter: `chapter`, `number` (строкой в кавычках), `title`, `tags`, `mvp: false`.
- Ниже - брифы уроков: тезисы, ключевые sql-блоки с ожиданиями, ловушки. Полный текст пишется по гайду, тезисы обязательны.

## Задача 13. Уроки главы 4: L4.4, L4.8, L4.9, L4.10

- **L4.4 Операторы: BETWEEN, IN, LIKE/ILIKE, IS DISTINCT FROM.** Тезисы: операторы сравнения расширяют `=`; BETWEEN симметричен границам; LIKE шаблоны `%`/`_`, ILIKE без регистра; `IS DISTINCT FROM` - трёхзначная логика в один шаг (NULL не «заражает»). Блоки: `select title, price from book where price between 350 and 610` (6 строк); `where title ilike '%python%'` (3); `where price is distinct from null` (1: «Остров», а `is not null` то же - показать разницу формулировок, `= null` даст 0). Ловушка: `between null and 100` - пусто, и почему.
- **L4.8 DISTINCT, DISTINCT ON.** Блоки: `select distinct category_id from book` (4: 3,4,6 и NULL - NULL считается равным); `select distinct on (author_id) title, author_id from book order by author_id, price desc` (у каждого автора самая дорогая книга; 6 строк: 5 авторов + 2 без... сверить: distinct on по author_id включая NULL-группу - 6 групп). Ловушка: DISTINCT ON без ORDER BY - какая строка «победит», непредсказуемо.
- **L4.9 CASE WHEN.** Блоки: корзины цен (3/4/3 + null-цена в else, 11 строк); `case` в ORDER BY; агрегат по case: `select count(*) filter (where price < 500) ...` или `sum(case when ... then 1 else 0 end)`. Сцена: аниматор case-ветки. Ловушка: порядок веток важен, первое сработавшее условие выигрывает.
- **L4.10 FROM без таблиц: VALUES, generate_series.** Блоки: `select * from (values (1, 'a'), (2, 'b')) as t(n, s)` (2); `select generate_series(1, 5)` (5); `select n, n * n from generate_series(1, 4) as n` (4). Тезис: FROM-клауза может не ходить в таблицы; сцена - «таблица из воздуха» (scan по VALUES). Ловушка: `generate_series` в SELECT vs FROM - размножение строк.

## Задача 14. Уроки главы 6: L6.1, L6.4-L6.13

- **L6.1 Связи 1:N, N:M, 1:1.** Тезисы: author-book 1:N (у автора много книг, у книги один автор), book-orders N:M через order_item, customer-email 1:1 (unique). FK-рёбра на доске. Блок: `select a.name, count(b.book_id) from author a left join book b using (author_id) group by a.name` (6 строк: у Пастернака 0).
- **L6.4 FULL OUTER JOIN.** Блок: `select a.name, b.title from author a full join book b using (author_id)` (11: 9 пар + 2 книги без автора; авторов без книг нет в join... Пастернак есть! 9 пар? книг с автором 9, авторов с книгами 5, Пастернак без книг +1, 2 книги без автора +2 = 12 строк. Сверить тестом). Сцена: NULL-половины с обеих сторон.
- **L6.5 CROSS JOIN.** Блок: `select a.name, b.title from author a cross join (select title from book limit 2) b` (12). Сцена: веер/сетка. Ловушка: cross join больших таблиц.
- **L6.6 SELF JOIN.** Блок: сотрудник-руководитель: `select e.name, m.name as boss from employee e join employee m on e.manager_id = m.employee_id` (7). Тезис: одна таблица, два алиаса, на доске две копии. Сцена: две копии с рёбрами.
- **L6.7 Три и более таблиц.** Блок: book-author-category (9 книг с автором и категорией... книг с автором 9, из них без категории 1 - «Простой Python» без автора. 9 книг с автором; у всех есть категория? Простой Python без автора и без категории - он не попадёт. Итого 9? Сверить тестом: 9). Тезис: цепочка join - дерево в плане, на доске - три таблицы съезжаются.
- **L6.8 NATURAL JOIN.** Блок: `select * from customer natural join orders` - соединение по общим именам колонок (customer_id). Тезис: удобно и опасно - переименование колонки меняет ключ молча. Ловушка: natural join по нескольким случайным совпадениям имён.
- **L6.9 ON vs WHERE при LEFT JOIN.** Два запроса рядом: `left join ... and b.price > 1000` vs `left join ... where b.price > 1000` - в первом у всех авторов есть строка (условие в ON не убивает строку, добавляет NULL-половину), во втором авторы без дорогих книг пропадают. Сцена: две сцены рядом (аниматор из задачи 10).
- **L6.10 SEMI JOIN: EXISTS, IN.** Блок: `select name from author a where exists (select 1 from book b where b.author_id = a.author_id)` (5). Тезис: semi join не размножает строки - проверка «есть хоть одна». Сцена: проверка + отвал.
- **L6.11 ANTI JOIN, ловушка NOT IN.** Блоки: `where not exists (...)` (1: Пастернак) vs `where author_id not in (select author_id from book)` (0 строк - NULL в списке). Главная ловушка урока и сцена: три стадии, вердикты UNKNOWN гасят всё.
- **L6.12 Размножение строк при JOIN.** Блок: `select o.order_id, count(*) from orders o join order_item i using (order_id) group by o.order_id` - книги в нескольких заказах дают по строке на пару. Сцена: клонирование строк (парная линия).
- **L6.13 JOIN LATERAL.** Блок: самая дорогая книга каждого автора (5 строк, см. задачу 7). Тезис: lateral видит строку внешней таблицы; сцена: мини-сцена на автора.

## Задача 15. Уроки главы 7: L7.4, L7.5

- **L7.4 FILTER, string_agg, array_agg, json_agg.** Блоки: `select count(*) filter (where rating >= 5), count(*) from review` (5, 10); `select name, string_agg(title, ', ' order by title) from book_category c join book b using (category_id) group by name` (категории с книгами; сверить count); `json_agg` по категории. Тезис: FILTER чище CASE внутри агрегата; order внутри агрегата.
- **L7.5 ROLLUP, CUBE, GROUPING SETS.** Блоки: rollup по категории (категория + ИТОГО); cube по (категория, автор) - все комбинации; grouping sets явно. `grouping()` для отличения NULL-ролапа. Сцена: стеки уровней (аниматор grouping из задачи 8).

## Задача 16. Уроки главы 8: L8.1-L8.8

- **L8.1 Скалярный подзапрос.** Блок: max_price у каждой книги (см. задачу 6). Тезис: один результат, подстановка; если подзапрос вернул 2 строки - ошибка. Сцена: мини-сцена схлопывается в значение.
- **L8.2 Подзапрос в FROM.** Блок: средняя цена по категориям с фильтром снаружи: `select * from (select category_id, avg(price) as avg_price from book group by category_id) s where avg_price > 500` (сверить). Сцена: materialize.
- **L8.3 Коррелированный подзапрос.** Блок: книги дороже средней по своему автору (7, задача 7). Сцена: 3 подробно + счётчик.
- **L8.4 IN, EXISTS, ANY, ALL.** Блоки: `price > all (select price from book where category_id = 6)` - дороже всех Python-книг? любые NULL дают... 6-я категория: 2400, 1990, 3200 - > all = 0 строк (3200 не > 3200); `> any` - 8 строк (все, что дороже хотя бы одной). ANY/ALL с NULL - та же ловушка NOT IN, показать.
- **L8.5 UNION, INTERSECT, EXCEPT.** Блоки: российские авторы union французские (7); фантастика intersect приключения (2); фантастика except классика (2: «Голова», «Остров» - классика не входит: категория 3 vs 4, except по name? соединять по колонке title с общим смыслом). Дубли: union vs union all на review с rating 4 и 5. Сцены: все четыре аниматора setop.
- **L8.6 CTE.** Блок: `with recent as (select * from orders where created_at >= '2024-05-01') select ...` (заказы мая: 2). Тезис: читаемость, одна материализация. Сцена: materialize + обычный пайплайн.
- **L8.7 Рекурсивный CTE.** Блок: дерево employee (задача 4), уровни. Тезисы: якорь + шаг, синтаксис, где стоп. Сцена: слои.
- **L8.8 MATERIALIZED, CTE с изменением данных.** Блоки: `with t as not materialized (...)` (инлайн); `with moved as (delete from review where rating = 1 returning ...) select count(*) from moved` - 0 удалений (rating 1 нет) или рейтинг 2: 1 строка. Превью откатывает DML - показать в превью и «Применить». `trace="final-only"` допустим для data-changing CTE, причина: стадия DML придёт в Ф9.

## Задача 17. Уроки главы 9: L9.1-L9.5 (датасет events)

- **L9.1 OVER(), PARTITION BY.** Блок: `select name, salary, avg(salary) over () from employee` (общая средняя у каждой строки); `over (partition by position)` (средняя по должности). Тезис: окно не схлопывает строки - контраст с GROUP BY (сцена: окраска партиций без схлопывания).
- **L9.2 row_number, rank, dense_rank.** Блок: зарплаты с rank: `select name, salary, row_number() over (order by salary desc), rank() over (order by salary desc), dense_rank() over (order by salary desc) from employee` - ничья 70000×2: rank 5,5,7 vs dense 5,5,6. Сцена: номера проставляются, ничьи подсвечены.
- **L9.3 lag, lead, first_value, last_value.** Блок: `select kind, amount, lag(amount) over (order by happened_at) from event where order_id = 7` (4 строки: created, paid 2110, shipped, returned; lag первой NULL). Тезис: сосед по окну. Сцена: стрелка от соседа.
- **L9.4 Накопительные итоги, рамка окна.** Блок: `select order_id, kind, amount, sum(amount) over (order by happened_at) from event where kind = 'paid'` - накопление платежей; рамка `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW` vs `RANGE` на order 3 (два события в одну секунду). Сцена: рамка едет.
- **L9.5 Top-N в группе.** Блок: самая дорогая книга категории: `select * from (select title, category_id, row_number() over (partition by category_id order by price desc nulls last) as rn from book) t where rn = 1` (4 строки: 3,4,6 и NULL-категория). Тезис: классический паттерн, NULLS LAST для null-цены. Сцена: партиции + номера.

## Задача 18. Golden-харнесс и закрытие фазы

**Files:**
- Create: `tests/tracer/golden-f10.queries.ts`, `golden-f10.test.ts`

- [ ] **Шаг 1. Golden.** Все запросы задач 2-9 и уроков 13-17 - в `golden-f10.queries.ts` (формат `GOLDEN` Ф5, отдельный экспорт `GOLDEN_F10`). Тест: финал каждой трассы совпадает с прямым выполнением; для `full` - полный пайплайн стадий снимками `summary()`.
- [ ] **Шаг 2. Сводка.** В `docs/PROGRESS.md` проверить: P10.1-P10.12 и все L4.4-L9.5 ✅, фаза «Ф10 Подзапросы, множества, CTE, окна» ⬜ → ✅ с датой. Коммит `docs(progress): Ф10 закрыта`.

## Покрытие пунктов трекера

- P10.1: этот план (согласование закрывает координатор отдельным коммитом).
- P10.2: задача 1. P10.3: задача 2. P10.4: задача 3. P10.5: задача 4. P10.6: задача 5. P10.7: задача 6. P10.8: задача 7. P10.9: задачи 6 (EXISTS/NOT IN) и 7 (semi/anti сцены в 14).
- P10.10: задачи 8 (CASE), 10 (аниматоры). P10.11: задачи 8 (ROLLUP/FILTER), 10 (аниматоры).
- P10.12: задача 9. E2E-сцены: задача 11.
- Уроки: L4.4-L4.10 - задача 13; L6.1-L6.13 - задача 14; L7.4-L7.5 - задача 15; L8.1-L8.8 - задача 16; L9.1-L9.5 - задача 17.

## Риски и что делать

- **EXCEPT ALL семантика.** Кратности в JS через Map канон→count; сверка финала обязательна (задача 2, golden).
- **Рекурсия зацикливается.** Лимит 50 итераций + пустая итерация; сторож VS001 ловит зависшее; после - `final-only`.
- **Коррелированный подзапрос по большой таблице.** maxRows → `final-only` сразу, без N прогонов; N=3 только в сценах.
- **Вolatile в CTE/подзапросе.** Наследование признака VOLATILE из Ф5 через whitelist: подзапрос с volatile = трасса `final-only`.
- **TEMP-таблицы конфликтуют.** Счётчик `__vs_m<N>` на трассу; тест вложенных CTE (2 уровня).
- **Числа уроков.** Посчитаны вручную 2026-10-08; арбитр - `pnpm test:content`; расхождение = ⚠️ и правка урока, не датасета.
