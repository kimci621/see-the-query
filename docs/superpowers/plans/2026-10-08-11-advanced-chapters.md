# Ф11 Продвинутые главы: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть главы 5, 10-14 программы: 37 уроков и 10 визуальных механизмов (раскрытие массивов и JSON, VIEW и MATERIALIZED VIEW на доске, MVCC-страница, сцены «две сессии» с проверкой на настоящем Postgres в CI, большой датасет и сжатые таблицы, B-дерево и счётчик прочитанных строк, вкладка «План», сцена нормализации, сцены главы 14).

**Architecture:** всё строится поверх Ф1-Ф10. Новое в трассировщике: стадия `expand` (функция из FROM раскрывает массив или документ в строки), опциональные поля `triggerEffects` и `routing` у стадии `dml`, опциональный `plan` у `Trace`. Сцены, которые не являются трассой запроса (MVCC-страница, B-дерево, нормализация, лексемы, две сессии), живут в теоретической колонке как MDX-компоненты: они берут данные у настоящего Postgres через `sandbox.preview`, превращают их в кадры чистыми функциями (`src/features/scenes/*`) и проигрывают локальным плеером. Сцены «две сессии» описаны TS-сценариями в `content/scenarios/`; их ход проверяет vitest-тест на настоящем PostgreSQL 18 (две реальные сессии через npm `pg`), в CI это отдельный job с сервисом `postgres:18`.

**Tech Stack:** PGlite 0.5.8 (PostgreSQL 18.3) + контрибы `pg_trgm`, `pageinspect`; libpg-query 18; React 19, motion, zustand; vitest; GitHub Actions; `pg@8.23.1` (только dev, для CI-раннера).

**Spec:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, разделы 4 («Транзакции, MVCC, индексы»), 5.13, 6.2, 6.3 (главы 5, 10-14), 8, 9. Контракты: `docs/superpowers/plans/2026-10-08-00-contracts.md`.

---

## Global Constraints

- Ф11 начинается после ✅ Ф0-Ф10. Внутренние функции прошлых фаз (сборщик стадий SELECT, трассировщик DML, `TableNode`, `ResultsPanel`, карта MDX-компонентов, тест контента) план называет по роли и даёт команду grep, которой их найти. Публичные интерфейсы берутся строго из контрактов.
- Задача 1 правит контракты отдельным коммитом `docs(contracts): ...` до любого кода (так требует шапка контрактов). Все типы ниже написаны уже в правленом виде.
- Инварианты из `CLAUDE.md` действуют без исключений. Особенно: результаты и ошибки только от Postgres; превью только в `BEGIN ... ROLLBACK`; неверную анимацию не показываем (сомнение → `final-only`).
- Сцены в теоретической колонке берут данные у Postgres. Своё вычисление SQL запрещено: группировку, видимость версий, путь по дереву отдаёт Postgres или pageinspect, JS только раскладывает и сверяет.
- Статистика активности в PGlite не собирается: `pg_stat_user_tables.n_live_tup`, `n_dead_tup`, `pg_stat_user_indexes.idx_scan` всегда 0 (проверено 2026-10-08). MVCC показываем через `pageinspect`, «ненужные индексы» через каталог, а `idx_scan` объясняем теорией.
- В PGlite нет автовакуума и фоновых процессов: мёртвые версии живут до ручного `VACUUM`.
- `VACUUM` и `CREATE INDEX CONCURRENTLY` нельзя выполнять в транзакционном блоке (25001), в том числе в многооператорном `exec`. В уроках это всегда отдельный блок `apply` из одного оператора.
- `statement_timeout` в PGlite не работает (docs/spikes.md). Тяжёлые примеры на `big_bookstore` держим в пределах сотен миллисекунд, защита только сторожем клиента.
- Часовой пояс сервера зависит от окружения (Node на машине с МСК даёт `Etc/GMT-3`, CI даёт `UTC`). Примеры с датами в уроках пишутся так, чтобы результат не зависел от пояса: `at time zone 'Europe/Moscow'` и литералы со смещением `+03`.
- Номера транзакций (xid) в тексте уроков не называем: они зависят от истории превью. Говорим только об отношениях («xmax старой версии = xmin новой»).
- Уроки: один урок = одна задача = один коммит. Тексты пишем своими словами по `docs/content-style.md`, курс «Диджитализируй!» только читаем. У каждого sql-блока есть `expect=rows:N` или `expectError=SQLSTATE` (или `noexec` для синтаксиса, который нельзя выполнить в песочнице). Все числа в брифах ниже проверены запуском на PGlite 0.5.8 и PostgreSQL 18.3 2026-10-08.
- Ожидание многооператорного блока относится к последнему оператору блока (уточнение контракта, задача 1). Ошибка в любом операторе блока проверяется через `expectError`.
- Якоря PG wiki «Don't Do This» в брифах написаны по шаблону вики. Перед коммитом урока открой каждую ссылку и проверь, что якорь ведёт на нужный пункт.
- Тексты интерфейса и комментарии в коде на русском, идентификаторы на английском. Без длинного тире.
- Каждая задача заканчивается шагом: в `docs/PROGRESS.md` поставить ✅ с датой на закрытые пункты, `pnpm check` зелёный, коммит `<type>(<area>): <описание>` с последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Перед началом задачи пункт трекера переводится в 🔄 с датой (правило трекера 1), это не отдельный коммит.

## Review Focus

1. Стадия `expand` честная: финал трассы совпадает с прямым выполнением, а форма `unnest` в SELECT уходит в `final-only` (задача 6, `src/features/tracer/srf.test.ts`).
2. Сценарии «две сессии» совпадают с настоящим Postgres шаг в шаг, включая блокировки и коды ошибок (задача 22, `src/features/sessions/scenarios.pg.test.ts`).
3. MVCC-страница различает живые, мёртвые, откатанные, перенаправленные версии и версии с одной лишь блокировкой в `xmax` (задача 20, `src/features/db/pageinspect.test.ts`).
4. Узел плана EXPLAIN связывается с правильной стадией трассы, счётчик «прочитано строк» считает отфильтрованные строки (задача 28, `src/features/tracer/explain.test.ts`).
5. Отставание MATERIALIZED VIEW считает Postgres, после `REFRESH` оно 0 (задача 17, `src/features/db/views.test.ts`).

## Карта файлов

Создаются:
- `src/features/db/extensions.ts`: контрибы песочницы.
- `src/features/db/pageinspect.ts`, `src/features/db/btree.ts`, `src/features/db/views.ts`: чтение страниц кучи, B-дерева, отставания матпредставлений.
- `src/features/tracer/srf.ts`: разбор и стадия `expand`.
- `src/features/tracer/explain.ts`: `PlanNode`, разбор EXPLAIN JSON, связь со стадиями.
- `src/features/tracer/dml/trigger-effects.ts`, `src/features/tracer/dml/routing.ts`: побочные эффекты триггеров, маршрутизация по секциям.
- `src/features/overlay/animators/expand.ts`, `src/features/overlay/animators/side-effects.ts`.
- `src/features/board/compressed.ts`.
- `src/features/scenes/`: `useStepper.ts`, `MiniTable.tsx`, `split.ts`, `lexemes.ts`, `btree-layout.ts` и тесты.
- `src/features/sessions/`: `types.ts`, `timeline.ts`, `TwoSessions.tsx`, `pg-runner.ts`, тесты.
- `src/features/lessons/mdx/`: `MvccPage.tsx`, `BTreeScene.tsx`, `SplitScene.tsx`, `LexemeScene.tsx`, `TwoSessionsBlock.tsx`.
- `src/features/results/PlanTree.tsx` (если Ф4 оставил заглушку, она заменяется).
- `content/datasets/big_bookstore.sql`.
- `content/scenarios/index.ts`, `content/scenarios/transactions.ts`, `content/scenarios/isolation.ts`, `content/scenarios/locks.ts`.
- `.github/workflows/sessions.yml`.
- 37 уроков в `content/lessons/05-types/`, `10-views/`, `11-transactions/`, `12-indexes/`, `13-design/`, `14-extras/`.

Меняются: `docs/superpowers/plans/2026-10-08-00-contracts.md`, `src/features/tracer/types.ts`, `src/features/db/introspect.ts`, `src/features/db/sandbox.ts`, `src/features/db/db.worker.ts`, `src/features/db/node-client.ts`, `src/features/board/model.ts`, `src/features/board/layout.ts`, `src/features/board/TableNode.tsx`, `src/features/overlay/playback.ts`, `src/features/tracer/captions.ts`, `src/features/tracer/whitelist.ts`, сборщик стадий SELECT и трассировщик DML (Ф5, Ф9), `src/stores/scene.ts`, `src/features/timeline/Timeline.tsx`, `src/features/results/ResultsPanel.tsx`, `src/features/editor/useLiveTrace.ts`, карта MDX-компонентов (Ф8), `vitest.config.ts`, `package.json`, `docs/datasets.md`, `docs/PROGRESS.md`.

## Порядок задач

1. Правки контрактов. 2. Контрибы песочницы. 3. `apply` откатывает незакрытую транзакцию. 4. Датасет `big_bookstore`. 5. Сжатые таблицы на доске (P11.7). 6. Стадия `expand`. 7. Аниматор `expand` (P11.2). 8-16. Уроки 5.1-5.9. 17. VIEW и MATVIEW на доске (P11.3). 18-19. Уроки 10.1-10.2. 20. Плеер шагов и MVCC-страница (P11.4). 21. Сценарии «две сессии» (P11.5). 22. Проверка сценариев на Postgres в CI (P11.6). 23-27. Уроки 11.1-11.5. 28. Вкладка «План» (P11.9). 29. B-дерево (P11.8). 30-36. Уроки 12.1-12.7. 37. Сцена нормализации (P11.10). 38-40. Уроки 13.1-13.3. 41. Лексемы FTS. 42. Триггер пишет в журнал. 43. Маршрутизация по секциям (P11.11). 44-49. Уроки 14.1-14.6. 50. Закрытие фазы.

---

## Задача 1. Правки контрактов

Контракты разрешают отклонение только после правки документа. Задача ничего не кодит.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-08-00-contracts.md`
- Modify: `docs/PROGRESS.md` (новый пункт P11.12)

**Interfaces:** см. текст правок в шаге 1.

- [ ] **Шаг 1. Внести правки в контракты.** Дословно:

  1. Раздел 1, после списка версий: «`pg@8.23.1` и `@types/pg` (devDependencies) для CI-проверки сценариев «две сессии» (Ф11).» В блоке фактов о PGlite: «Контрибы `pg_trgm` и `pageinspect` регистрируются в песочнице всегда (`SANDBOX_EXTENSIONS` в `features/db/extensions.ts`), `create extension` делает урок или сцена. Статистика активности (`pg_stat_*`: `n_live_tup`, `n_dead_tup`, `idx_scan`) в PGlite не собирается, всегда 0. Автовакуума нет.»
  2. Раздел 3, раскладка: добавить `features/scenes/  useStepper.ts MiniTable.tsx split.ts lexemes.ts btree-layout.ts`, `features/sessions/  types.ts timeline.ts TwoSessions.tsx pg-runner.ts`, `content/scenarios/<group>.ts`, `.github/workflows/sessions.yml`. Проект vitest `node` дополняется путями `src/features/{scenes,sessions}/**/*.test.ts`.
  3. Раздел 4, `introspect.ts`: в `TableInfo` поле `matviewLag?: number | null` (только для `kind: 'matview'`: сколько строк отличается от свежего выполнения определения, `null` = неизвестно); в `SchemaSnapshot` поле `viewDeps?: Array<{ viewId: string; tableId: string }>`.
  4. Раздел 4, `sandbox.ts`: «`apply` при ошибке выполняет `rollback`, чтобы явный `begin` из примера не оставил сессию в прерванной транзакции (25P02).»
  5. Раздел 6, `types.ts`:
     - `Lineage`: «для функции во FROM (`unnest`, `jsonb_each`...) значение = `'#' + ordinality`, например `'#2'`».
     - новый вариант `Stage`: `| { kind: 'expand'; fn: string; alias: string; sourceAlias: string; sourceColumn: string; children: Array<{ parent: RowKey; keys: RowKey[] }> }`.
     - у варианта `dml` два опциональных поля: `triggerEffects?: Array<{ tableId: string; triggers: string[]; added: Relation }>`, `routing?: { parentId: string; columns: string[]; rows: Array<{ values: unknown[]; partitionId: string }> }`.
     - у `Trace` опциональное поле `plan?: PlanNode | null` (тип из `features/tracer/explain.ts`).
  6. Раздел 7, `SceneStore`: `hoveredStage: number | null; setHoveredStage(i: number | null): void;`.
  7. Раздел 8, MDX-компоненты: `<TwoSessions id>`, `<MvccPage table>`, `<BTreeScene table index column value>`, `<SplitScene source keyColumn extract target>`, `<LexemeScene text config>`. Про sql-блоки: «ожидание многооператорного блока проверяется на последнем операторе; `expectError` срабатывает на ошибку любого оператора».

- [ ] **Шаг 2. Трекер.** В `docs/PROGRESS.md` в раздел Ф11 после P11.11 добавить пункт `- ✅ **P11.12** (<дата>) Правки контрактов под Ф11 (expand, plan, triggerEffects, routing, viewDeps, hoveredStage, MDX-компоненты сцен, pg для CI).`

- [ ] **Шаг 3. Коммит.**
  ```bash
  git add docs/superpowers/plans/2026-10-08-00-contracts.md docs/PROGRESS.md
  git commit -m "docs(contracts): правки под Ф11: expand, plan, сцены, CI на Postgres

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 2. Контрибы песочницы: pg_trgm и pageinspect

Уроки 12.6 и 14.1 используют `pg_trgm`, сцены MVCC и B-дерева используют `pageinspect`. Расширение должно быть зарегистрировано при создании PGlite, иначе `create extension` падает.

**Files:**
- Create: `src/features/db/extensions.ts`
- Modify: `src/features/db/db.worker.ts`, `src/features/db/node-client.ts` (место `new PGlite(...)`, найти `grep -n "new PGlite" src/features/db`)
- Test: `src/features/db/extensions.test.ts`

**Interfaces:**
```ts
export const SANDBOX_EXTENSIONS: { pg_trgm: Extension; pageinspect: Extension };
```

- [ ] **Шаг 1. Падающий тест.** `src/features/db/extensions.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { createNodeClient } from './node-client';

  describe('контрибы песочницы', () => {
    it('pg_trgm и pageinspect ставятся через create extension', async () => {
      const db = await createNodeClient();
      try {
        await db.exec('create extension pg_trgm; create extension pageinspect;');
        const trgm = await db.query("select round(similarity('Пушкин', 'Пушкинн')::numeric, 2)::text");
        expect(trgm.rows[0][0]).toBe('0.67');
        await db.exec('create table t (x int); insert into t values (1), (2);');
        const page = await db.query("select count(*)::int from heap_page_items(get_raw_page('t', 0))");
        expect(page.rows[0][0]).toBe(2);
      } finally {
        await db.close();
      }
    });
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/extensions.test.ts`. Ожидается FAIL: `extension "pg_trgm" is not available` или `could not open extension control file`.
- [ ] **Шаг 3. Код.** `src/features/db/extensions.ts`:
  ```ts
  import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
  import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

  // Контрибы регистрируются при создании PGlite. Сама установка (create extension)
  // остаётся за уроком или сценой, чтобы датасеты не менялись.
  export const SANDBOX_EXTENSIONS = { pg_trgm, pageinspect };
  ```
  В `db.worker.ts` и `node-client.ts` в опции `new PGlite({...})` добавить `extensions: SANDBOX_EXTENSIONS` (с импортом `import { SANDBOX_EXTENSIONS } from './extensions';`).
- [ ] **Шаг 4. Запуск.** Та же команда, ожидается PASS. Затем `pnpm check`. Проверить в `pnpm dev`, что доска поднимается не дольше прежнего (спека 9: < 2 с на холодную); если стало дольше, записать замер в `docs/spikes.md` строкой «контрибы +N мс к старту».
- [ ] **Шаг 5. Трекер и коммит.** Пункт трекера не закрывается (это подготовка P11.4 и P11.8). Коммит:
  ```bash
  git add src/features/db/extensions.ts src/features/db/extensions.test.ts src/features/db/db.worker.ts src/features/db/node-client.ts
  git commit -m "feat(db): контрибы pg_trgm и pageinspect в песочнице

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 3. `apply` откатывает незакрытую транзакцию

Проверено на PGlite 0.5.8: `exec("begin; update customer set bonus = bonus - 500 where customer_id = 2; commit;")` падает с 23514, а следующий запрос получает `25P02 current transaction is aborted`. Уроки главы 11 применяют такие блоки, поэтому песочница должна закрывать транзакцию сама.

**Files:**
- Modify: `src/features/db/sandbox.ts` (метод `apply`)
- Test: `src/features/db/sandbox.apply-tx.test.ts`

**Interfaces:** без изменений сигнатур (`apply(sql): Promise<QueryResult[]>`).

- [ ] **Шаг 1. Падающий тест.**
  ```ts
  import { describe, expect, it } from 'vitest';
  import { createNodeClient } from './node-client';
  import { createSandbox } from './sandbox';

  describe('sandbox.apply и явные транзакции', () => {
    it('после ошибки внутри begin ... commit сессия снова рабочая, журнал не растёт', async () => {
      const sandbox = createSandbox((dataDir) => createNodeClient({ dataDir }));
      await sandbox.loadLesson('bookstore', []);
      await expect(
        sandbox.apply('begin; update customer set bonus = bonus - 500 where customer_id = 2; commit;'),
      ).rejects.toMatchObject({ db: { code: '23514' } });
      const r = await sandbox.client().query('select bonus from customer where customer_id = 2');
      expect(r.rows[0][0]).toBe(0);
      expect(sandbox.journal()).toEqual([]);
    });
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/sandbox.apply-tx.test.ts`. Ожидается FAIL: `DbException` с кодом `25P02` на втором запросе.
- [ ] **Шаг 3. Код.** В `apply` обернуть выполнение:
  ```ts
  try {
    results = await this.client().exec(sql);
  } catch (e) {
    // Пример мог открыть транзакцию явным begin и упасть до commit.
    // Без отката сессия остаётся в состоянии 25P02. rollback вне транзакции даёт только WARNING.
    await this.client().exec('rollback').catch(() => {});
    throw e;
  }
  ```
  (Имена переменных взять из текущего кода `apply`. Журнал пополняется только после успешного `exec`, как и было.)
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check` зелёный.
- [ ] **Шаг 5. Коммит.**
  ```bash
  git add src/features/db/sandbox.ts src/features/db/sandbox.apply-tx.test.ts
  git commit -m "fix(db): apply откатывает транзакцию, оставленную упавшим примером

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 4. Датасет big_bookstore

**Files:**
- Create: `content/datasets/big_bookstore.sql`
- Modify: `docs/datasets.md` (раздел «big_bookstore»)
- Test: `src/features/db/big-bookstore.test.ts`

**Interfaces:** `DatasetId` уже содержит `'big_bookstore'` (контракты, раздел 4).

Проверенные факты (PGlite 0.5.8 в Node, 2026-10-08): загрузка 2.0-2.2 с; `book` 100 000, `orders` 100 000, `customer` 20 000, `author` 2 000; статусы new 3 000, paid 67 000, shipped 25 000, cancelled 5 000; `orders` 736 страниц (5888 kB), `orders_pkey` 2208 kB (276 страниц, B-дерево в 2 уровня); `dumpDataDir('gzip')` 760 мс и 15.4 МБ, `loadDataDir` из gzip 403 мс; у покупателя 42 ровно 5 заказов; за сутки 2023-06-01 288 заказов; в `book` 16 667 названий с «Python», 16 666 с «кошках», 25 000 книг с тегом `python`, 10 000 с `meta.lang = 'en'`.

- [ ] **Шаг 1. Падающий тест.**
  ```ts
  import { describe, expect, it } from 'vitest';
  import { withDataset } from '../../../tests/helpers/db';

  describe('датасет big_bookstore', () => {
    it('грузится и даёт объёмы, на которые опираются уроки главы 12', async () => {
      await withDataset('big_bookstore', async (db) => {
        const sizes = await db.query(
          'select (select count(*) from book)::int, (select count(*) from orders)::int, (select count(*) from customer)::int, (select count(*) from author)::int',
        );
        expect(sizes.rows[0]).toEqual([100000, 100000, 20000, 2000]);
        const statuses = await db.query('select status::text, count(*)::int from orders group by status order by status');
        expect(statuses.rows).toEqual([['new', 3000], ['paid', 67000], ['shipped', 25000], ['cancelled', 5000]]);
        const anchors = await db.query(
          "select (select count(*) from orders where customer_id = 42)::int, (select count(*) from orders where created_at >= '2023-06-01 00:00+03' and created_at < '2023-06-02 00:00+03')::int",
        );
        expect(anchors.rows[0]).toEqual([5, 288]);
      });
    }, 60_000);
  });
  ```
  Внимание: литерал `'2023-06-01'` без смещения зависит от часового пояса. В уроках используется он (вывод «288» получен в поясе `Etc/GMT-3`), в тесте смещение явное. Если тест контента в CI (UTC) даст другое число на уроке, урок переписывается на литерал со смещением `+03`.
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/big-bookstore.test.ts`. FAIL: файла датасета нет.
- [ ] **Шаг 3. Датасет.** `content/datasets/big_bookstore.sql`:
  ```sql
  -- Датасет big_bookstore: схема bookstore с большими объёмами для глав про индексы.
  -- Данные детерминированы (без random()), чтобы ожидания в уроках не плавали.
  -- Индексов, кроме PK и UNIQUE, нет: уроки создают их сами.

  create type order_status as enum ('new', 'paid', 'shipped', 'cancelled');

  create table author (
    author_id bigint generated always as identity primary key,
    name text not null,
    country text,
    born_year int
  );

  insert into author (name, country, born_year)
  select 'Автор ' || g,
         (array['Россия', 'Франция', 'Бразилия', 'Германия', 'Япония'])[1 + g % 5],
         1800 + g % 200
  from generate_series(1, 2000) as g;

  create table book_category (
    category_id int generated always as identity primary key,
    name text not null unique,
    parent_id int references book_category (category_id)
  );

  insert into book_category (name, parent_id) values
    ('Художественная литература', null),
    ('Литература по программированию', null),
    ('Фантастика', 1),
    ('Классика', 1),
    ('Литература по фотографии', null),
    ('Python', 2);

  create table book (
    book_id bigint generated always as identity primary key,
    title text not null,
    author_id bigint references author (author_id),
    category_id int references book_category (category_id),
    price numeric(10, 2),
    pages int,
    published_at date,
    tags text[] not null default '{}',
    meta jsonb
  );

  insert into book (title, author_id, category_id, price, pages, published_at, tags, meta)
  select 'Книга ' || g || ' ' || (array['о море', 'о войне', 'о Python', 'о любви', 'о космосе', 'о кошках'])[1 + g % 6],
         case when g % 50 = 0 then null else 1 + (g * 7919) % 2000 end,
         case when g % 97 = 0 then null else (array[3, 4, 6, 3, 4, 2])[1 + g % 6] end,
         case when g % 41 = 0 then null else (100 + (g * 37) % 4900)::numeric(10, 2) end,
         50 + (g * 13) % 1500,
         date '1950-01-01' + (g * 11) % 27000,
         case g % 4 when 0 then '{классика}'::text[] when 1 then '{фантастика,приключения}' when 2 then '{python,beginner}' else '{}' end,
         jsonb_build_object('lang', case when g % 10 = 0 then 'en' else 'ru' end)
  from generate_series(1, 100000) as g;

  create table customer (
    customer_id bigint generated always as identity primary key,
    name text not null,
    email text not null unique,
    city text,
    bonus int not null default 0 check (bonus >= 0),
    settings jsonb not null default '{}',
    created_at timestamptz not null
  );

  insert into customer (name, email, city, bonus, settings, created_at)
  select 'Покупатель ' || g,
         'User' || g || '@Example.com',
         case when g % 25 = 0 then null else (array['Москва', 'Казань', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Самара', 'Омск', 'Пермь'])[1 + g % 8] end,
         g % 500,
         jsonb_build_object('notify', g % 3 = 0),
         timestamptz '2022-01-01 00:00:00+03' + g * interval '20 minutes'
  from generate_series(1, 20000) as g;

  create table orders (
    order_id bigint generated always as identity primary key,
    customer_id bigint not null references customer (customer_id),
    status order_status not null default 'new',
    created_at timestamptz not null
  );

  -- created_at растёт вместе с order_id: физический порядок совпадает со временем (нужно для BRIN).
  -- bigint в умножении обязателен: g * 104729 переполняет int (22003).
  insert into orders (customer_id, status, created_at)
  select 1 + (g::bigint * 104729) % 20000,
         (case when g % 100 < 3 then 'new' when g % 100 < 70 then 'paid' when g % 100 < 95 then 'shipped' else 'cancelled' end)::order_status,
         timestamptz '2023-01-01 00:00:00+03' + g * interval '5 minutes'
  from generate_series(1, 100000) as g;

  analyze;
  ```
- [ ] **Шаг 4. docs/datasets.md.** Раздел «big_bookstore»: назначение (глава 12), объёмы и якоря из списка фактов выше, особенности: нет `order_item`, `employee`, `review`; email в смешанном регистре (`User42@Example.com`) для урока об индексе по выражению; 3 000 заказов `new` на 600 покупателей (частичный уникальный индекс падает с 23505 на `customer_id = 7501`); `created_at` монотонен (BRIN).
- [ ] **Шаг 5. Запуск.** Тест PASS (60 с таймаут с запасом), `pnpm check`.
- [ ] **Шаг 6. Коммит** (P11.7 закрывается в задаче 5).
  ```bash
  git add content/datasets/big_bookstore.sql docs/datasets.md src/features/db/big-bookstore.test.ts
  git commit -m "feat(content): датасет big_bookstore на 100 тысяч строк

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 5. Сжатый вид больших таблиц на доске

Таблица больше 1 000 строк рисуется сжато: шапка, колонки, первые 5 строк и полоса «ещё 99 995 строк». Анимации стадий больше 200 строк уже сжимает Ф6 (P6.18), здесь только базовая доска.

**Files:**
- Create: `src/features/board/compressed.ts`, `src/features/board/compressed.test.ts`
- Modify: `src/features/board/layout.ts` (`tableHeight`), `src/features/board/TableNode.tsx`
- Test: `src/features/board/TableNode.compressed.test.tsx`

**Interfaces:**
```ts
export const COMPRESS_AFTER = 1000;
export const COMPRESSED_ROWS = 5;
export function isCompressed(t: TableInfo): boolean;
export function hiddenRowsLabel(t: TableInfo): string;   // 'ещё 99 995 строк'
```

- [ ] **Шаг 1. Падающие тесты.** `compressed.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import type { TableInfo } from '@/features/db/introspect';
  import { tableHeight, HEADER_HEIGHT, ROW_HEIGHT } from './layout';
  import { COMPRESSED_ROWS, hiddenRowsLabel, isCompressed } from './compressed';

  const table = (rowCount: number): TableInfo => ({
    id: 'public.orders', schema: 'public', name: 'orders', kind: 'table', columns: [],
    rowCount, sampleRows: Array.from({ length: Math.min(rowCount, 15) }, () => []), sampleCtids: [],
    indexes: [], comment: null,
  });

  describe('сжатый вид таблицы', () => {
    it('включается после 1000 строк', () => {
      expect(isCompressed(table(1000))).toBe(false);
      expect(isCompressed(table(1001))).toBe(true);
    });
    it('подпись считает скрытые строки по-русски', () => {
      expect(hiddenRowsLabel(table(100000))).toMatch(/^ещё 99\s995 строк$/);
    });
    it('высота: шапка, 5 строк и полоса', () => {
      expect(tableHeight(table(100000))).toBe(HEADER_HEIGHT + (COMPRESSED_ROWS + 1) * ROW_HEIGHT);
    });
  });
  ```
  `TableNode.compressed.test.tsx` (dom): рендер `TableNode` с `table(100000)` и 15 строками в `sampleRows` показывает ровно 5 строк данных (`getAllByRole('row')` минус строка заголовка) и текст `/ещё 99\s995 строк/`. Обёртку провайдеров взять из существующего `TableNode.test.tsx` (Ф3).
- [ ] **Шаг 2. Запуск.** `pnpm vitest run src/features/board/compressed.test.ts src/features/board/TableNode.compressed.test.tsx`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.** `compressed.ts`:
  ```ts
  import type { TableInfo } from '@/features/db/introspect';

  // Порог сжатия базовой доски: дальше строки глазами уже не читаются (спека 6.2, big_bookstore).
  export const COMPRESS_AFTER = 1000;
  export const COMPRESSED_ROWS = 5;

  const ruNumber = new Intl.NumberFormat('ru-RU');

  export function isCompressed(t: TableInfo): boolean {
    return t.rowCount > COMPRESS_AFTER;
  }

  function plural(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'строка';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'строки';
    return 'строк';
  }

  export function hiddenRowsLabel(t: TableInfo): string {
    const hidden = t.rowCount - Math.min(COMPRESSED_ROWS, t.sampleRows.length);
    return `ещё ${ruNumber.format(hidden)} ${plural(hidden)}`;
  }
  ```
  В `layout.ts` в начале `tableHeight`: `if (isCompressed(t)) return HEADER_HEIGHT + (COMPRESSED_ROWS + 1) * ROW_HEIGHT;`. В `TableNode.tsx`: при `isCompressed(table)` рендерить `table.sampleRows.slice(0, COMPRESSED_ROWS)` и последней строкой `<tr><td colSpan={columns.length} className="text-muted-foreground italic">{hiddenRowsLabel(table)}</td></tr>` с иконкой `⋯` (`aria-hidden`).
- [ ] **Шаг 4. Запуск.** Тесты PASS, `pnpm check`. Глазами: `pnpm dev`, урок на `big_bookstore` (временно `dataset: big_bookstore` в любом уроке, не коммитить) показывает сжатые `book`, `orders`, `customer`, `author` и полноразмерную `book_category`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.7` → `✅ (<дата>)`.
  ```bash
  git add src/features/board docs/PROGRESS.md
  git commit -m "feat(board): сжатый вид таблиц больше 1000 строк

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 6. Стадия `expand`: `unnest` и jsonb-функции в FROM

Уроки 5.7 и 5.8 строятся на функциях, раскрывающих массив или документ в строки. Трассировщик Ф10 уже умеет материализовать подзапросы во временные таблицы. Здесь тот же приём применяется к парам «источник + функция» из FROM: `unnest`, `jsonb_array_elements`, `jsonb_each`. Стадия `expand` (тип из контрактов, задача 1) встаёт сразу после `scan` источника и связывает потомков с родителем.

**Files:**
- Create: `src/features/tracer/srf.ts`, `src/features/tracer/srf.test.ts`
- Modify: `src/features/tracer/types.ts` (вариант `expand` у `Stage`), `src/features/tracer/whitelist.ts`, сборщик стадий SELECT (Ф5/Ф10, найти: `grep -rn "materialize" src/features/tracer/select`)

**Interfaces:**
```ts
// srf.ts
export const SRF_FUNCTIONS: readonly string[];   // ['unnest', 'jsonb_array_elements', 'jsonb_each']
export interface SrfFromItem { fn: string; alias: string; sourceAlias: string; sourceColumn: string }
export function findSrfFromItems(stmt: ParsedStatement): SrfFromItem[];
```

- [ ] **Шаг 1. Падающий тест.** `src/features/tracer/srf.test.ts`:
  ```ts
  import { beforeAll, describe, expect, it } from 'vitest';
  import { introspect } from '@/features/db/introspect';
  import { initParser, parseSql } from '@/features/sql/parser';
  import { withDataset, inPreview } from '../../../tests/helpers/db';
  import { traceStatement } from './trace';

  const traceOf = (db: Parameters<typeof traceStatement>[1], sql: string) => {
    const parsed = parseSql(sql);
    const stmt = parsed.statements[0];
    if (!stmt) throw new Error('пустой разбор');
    return inPreview(db, async () => traceStatement(stmt, db, { schema: await introspect(db) }));
  };

  describe('стадия expand (функции в FROM)', () => {
    beforeAll(() => initParser());

    it('unnest: массив взрывается в строки, потомки привязаны к родителю', async () => {
      await withDataset('bookstore', async (db) => {
        const trace = await traceOf(db, 'select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5');
        expect(trace.mode).toBe('full');
        expect(trace.stages.map((s) => s.kind)).toEqual(['scan', 'expand', 'filter', 'project']);
        const expand = trace.stages.find((s) => s.kind === 'expand');
        expect(expand).toMatchObject({ fn: 'unnest', alias: 'u', sourceAlias: 'b', sourceColumn: 'tags' });
        // у книги 5 три тега: три потомка у одного родителя
        expect(expand?.children).toEqual([{ parent: 'b=(0,5)', keys: ['#1', '#2', '#3'] }]);
        expect(trace.result?.rows).toHaveLength(3);
      });
    }, 60_000);

    it('jsonb_each: документ раскрывается в пары ключ-значение', async () => {
      await withDataset('bookstore', async (db) => {
        const trace = await traceOf(
          db,
          'select c.customer_id, s.key, s.value from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 1',
        );
        expect(trace.mode).toBe('full');
        const expand = trace.stages.find((s) => s.kind === 'expand');
        expect(expand).toMatchObject({ fn: 'jsonb_each', alias: 's', sourceAlias: 'c', sourceColumn: 'settings' });
        expect(expand?.children).toEqual([{ parent: 'c=(0,1)', keys: ['#1', '#2'] }]);
        expect(trace.result?.rows).toHaveLength(2);
      });
    }, 60_000);

    it('jsonb_array_elements: элементы массива становятся строками', async () => {
      await withDataset('bookstore', async (db) => {
        const trace = await traceOf(
          db,
          "select e.elem from (values ('[1,2,3]'::jsonb)) as j (doc), jsonb_array_elements(j.doc) as e (elem)",
        );
        expect(trace.mode).toBe('full');
        const expand = trace.stages.find((s) => s.kind === 'expand');
        expect(expand).toMatchObject({ fn: 'jsonb_array_elements', alias: 'e', sourceAlias: 'j', sourceColumn: 'doc' });
        expect(expand?.children).toEqual([{ parent: 'j=(0,1)', keys: ['#1', '#2', '#3'] }]);
        expect(trace.result?.rows).toHaveLength(3);
      });
    }, 60_000);

    it('unnest в списке SELECT уходит в final-only', async () => {
      await withDataset('bookstore', async (db) => {
        const trace = await traceOf(db, 'select unnest(tags) as tag from book where book_id = 5');
        expect(trace.mode).toBe('final-only');
        expect(trace.fallbackReason).toBe('set-returning функция в списке SELECT');
      });
    }, 60_000);
  });
  ```
  Ожидание `parent: 'b=(0,5)'` опирается на то, что книга 5 лежит в `(0,5)` (строки `book` вставляются по порядку 1-11). Если Ф10 нумерует ключи иначе, поправить тест на фактический формат, не ослабляя проверку состава.
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/tracer/srf.test.ts`. Ожидается FAIL: варианта `expand` у `Stage` нет, трасса уходит в `final-only`.
- [ ] **Шаг 3. Код.** `src/features/tracer/srf.ts`:
  - `SRF_FUNCTIONS` = `['unnest', 'jsonb_array_elements', 'jsonb_each']`.
  - `findSrfFromItems`: обходит FROM оператора (AST), находит `RangeFunction`, у которой `funcname` из списка, а единственный аргумент это `ColumnRef` с квалификатором, ссылающимся на более ранний алиас FROM (неявный LATERAL). Возвращает `SrfFromItem`.
  - Проба: пару «источник + функция» материализовать во временную таблицу по образцу Ф10, но с lineage-колонками: `create temp table __vs_<n> as select <колонки источника>, <колонки функции>, <source>.ctid as __vs_<source>, '#' || <fn-alias>.ordinality as __vs_<fn-alias> from <from-часть до функции включительно, с добавленным with ordinality>`. Если у функции нет `with ordinality` в исходнике, проба добавляет его сама (алиас колонки `ordinality`). Дальнейшие пробы (filter, project...) переписывают пару алиасов на временную таблицу, как это делает Ф10 для подзапросов; lineage строки: `{b: '(0,5)', u: '#2'}`.
  - Стадия `expand` собирается из содержимого временной таблицы до применения WHERE: группировка по `__vs_<source>` даёт `children` (parent = rowKeyOf только по source-алиасу, keys = `#n`). Подпись в `captions.ts`: `«<fn>: 1 строка → 3 строки»`.
  - Интеграция: сборщик стадий SELECT перед своей работой зовёт `findSrfFromItems`; пусто → путь Ф5/Ф10 без изменений; непусто → материалайзер пар + стадия `expand` после `scan` источника.
  - `whitelist.ts`: SRF в списке SELECT (узел `FuncCall` c функцией из `SRF_FUNCTIONS` в target list) → причина `set-returning функция в списке SELECT`; функция из FROM, не входящая в список → причина с именем функции.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`. Проверить, что уроки Ф8-Ф10 не просели: `pnpm test:content`.
- [ ] **Шаг 5. Коммит.** Пункт трекера не закрывается (аниматоры в задаче 7).
  ```bash
  git add src/features/tracer/srf.ts src/features/tracer/srf.test.ts src/features/tracer/types.ts src/features/tracer/whitelist.ts src/features/tracer/captions.ts src/features/tracer/select
  git commit -m "feat(tracer): стадия expand для unnest и jsonb-функций в FROM

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 7. Аниматор `expand` (P11.2)

Метафора спеки 4: массив «взрывается» в строки, jsonb-документ раскрывается в колонки и строки. Аниматор чистый, без DOM, тестируется как остальные аниматоры Ф6.

**Files:**
- Create: `src/features/overlay/animators/expand.ts`, `src/features/overlay/animators/expand.test.ts`
- Modify: `src/features/overlay/playback.ts` (карта `ANIMATORS`), `src/features/tracer/captions.ts` (если подпись не добавлена задачей 6)

**Interfaces:** сигнатура `Animator` из контрактов, раздел 10. Потребляет стадию `expand` из задачи 6.

- [ ] **Шаг 1. Падающий тест.** `src/features/overlay/animators/expand.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import type { Stage, Relation } from '@/features/tracer/types';
  import { expandAnimator } from './expand';

  const rel: Relation = {
    columns: [{ name: 'tag' }],
    rows: [
      { key: '#1', lineage: { b: '(0,5)', u: '#1' }, values: ['классика'] },
      { key: '#2', lineage: { b: '(0,5)', u: '#2' }, values: ['сказка'] },
      { key: '#3', lineage: { b: '(0,5)', u: '#3' }, values: ['детям'] },
    ],
  };

  const stage = {
    kind: 'expand',
    id: 's2',
    caption: 'unnest: 1 строка → 3 строки',
    fn: 'unnest',
    alias: 'u',
    sourceAlias: 'b',
    sourceColumn: 'tags',
    children: [{ parent: 'b=(0,5)', keys: ['#1', '#2', '#3'] }],
    output: rel,
  } as Stage;

  const ctx = {
    nodeRect: (id: string) => (id === 'public.book' ? { x: 0, y: 0, width: 260, height: 120 } : null),
    workArea: { x: 300, y: 0 },
    schema: { schemas: ['public'], tables: [], fks: [], sequences: [] },
  };

  describe('аниматор expand', () => {
    it('unnest: три фазы, мини-таблица u растёт из ячейки массива', () => {
      const prev = { tables: [], decorations: [] };
      const phases = expandAnimator(prev, stage as never, 1, ctx as never);
      expect(phases.length).toBeGreaterThanOrEqual(3);
      // финальный кадр: призрак u с тремя строками, рядом с призраком источника
      const last = phases.at(-1)?.frame;
      const u = last?.tables.find((t) => t.id === 'u');
      expect(u?.rows).toHaveLength(3);
      // у каждого родителя есть скобка-связь с потомками
      expect(phases.some((p) => p.frame.decorations.some((d) => d.kind === 'bracket'))).toBe(true);
      // счётчик «3 элемента» на стопке
      expect(phases.some((p) => p.frame.decorations.some((d) => d.kind === 'counter'))).toBe(true);
    });

    it('jsonb_each: колонки key и value выращиваются из ячейки документа', () => {
      const jsonStage = { ...stage, fn: 'jsonb_each', alias: 's', sourceColumn: 'settings' };
      const prev = { tables: [], decorations: [] };
      const phases = expandAnimator(prev, jsonStage as never, 1, ctx as never);
      const last = phases.at(-1)?.frame;
      const s = last?.tables.find((t) => t.id === 's');
      expect(s?.columns.map((c) => c.name)).toEqual(['key', 'value']);
      expect(s?.rows).toHaveLength(3);
    });
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/overlay/animators/expand.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.** `expand.ts` (ключевое):
  - Фаза 1 «подсветка источника»: в призраке источника подсвечивается колонка `sourceColumn` (`state: 'highlight'`), на ячейках-родителях бейджи-счётчики `<N> элемента` (decoration `counter`).
  - Фаза 2 «раскрытие»: под призраком источника появляется мини-таблица `alias`; для `unnest`/`jsonb_array_elements` строки выезжают по одной из ячейки родителя (движение по `layoutId`), для `jsonb_each` строки фиксируются, а колонки `key`/`value` «выращиваются» справа из ячейки-документа (как вычисляемые колонки в `project`).
  - Фаза 3 «связи»: у каждого родителя скобка (`bracket`) вокруг его строк-потомков в мини-таблице; источники без потомков остаются с бейджем «0». Подпись фазы = `stage.caption`.
  - `prefers-reduced-motion` уже уважает плеер Ф6, отдельной ветки нет.
  - Регистрация в `playback.ts`: `ANIMATORS.expand = expandAnimator`.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.2` → `✅ (<дата>)`.
  ```bash
  git add src/features/overlay/animators/expand.ts src/features/overlay/animators/expand.test.ts src/features/overlay/playback.ts src/features/tracer/captions.ts docs/PROGRESS.md
  git commit -m "feat(overlay): аниматор expand: массив взрывается в строки, документ раскрывается

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Уроки главы 5 (задачи 8-16)

Общие правила для задач уроков (помимо Global Constraints):

- Формат, тон и структура: `docs/content-style.md`. DoD урока в трекере обязателен.
- Каждый урок = приёмочный тест задач 6-7: примеры с `unnest`/`jsonb_*` обязаны давать трассу `full`. Иначе это дыра задач 6-7, чинить их, а не помечать урок.
- Числа ожиданий проверены запуском на PGlite 0.5.8 (PostgreSQL 18.3) 2026-10-08 по `content/datasets/bookstore.sql`. Расхождение = поменялся датасет: ⚠️ и `Заметка:`.
- `tests/content/lessons.test.ts` хранит список уроков по гайду (формат задачи 9 плана Ф8). Первая задача урока правит его так: проверка `mvp: true` относится только к 13 MVP-урокам Ф8, они остаются в списке `MVP_LESSONS`; новый список `GUIDE_LESSONS` растёт с каждым уроком Ф11 и проверяет структуру без `mvp`. Если файл ещё устроен как один список с проверкой `mvp`, вынести MVP-проверку в отдельный `describe` по `MVP_LESSONS` (это часть падающего теста задачи 8, дальше не повторяется).
- Роли, триггеры и партиции в уроках главы 5 не встречаются; из write-операций только один блок в 5.6 (ожидаемая ошибка вставки значения enum), он идёт run-блоком и откатывается превью.

---

## Задача 8. Урок 5.1 «Типы и приведение» (L5.1)

**Files:**
- Create: `content/lessons/05-types/01-types-casting.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: `docs/content-style.md`, датасет `bookstore`, MDX-компоненты Ф8, раннер контента.
- Числа-якоря (сверены): `price > '500'` → 7 строк; `price > 500 and price < 1000` → 4 строки («Тихий Дон», «Голова профессора Доуэля», «Путешествие к центру Земли», «Дети капитана Гранта»); `title = 5` → `42883`; `'abc'::int` → `22P02`; `'42'::int + 1` → 43; `price::text || ' ₽'` у книги 1 → «890.00 ₽».

- [ ] **Шаг 1. Взять пункт в работу.**
  ```bash
  sed -i '' -E "s/^- ⬜ \*\*L5\.1\*\*/- 🔄 ($(date +%F)) **L5\.1**/" docs/PROGRESS.md
  ```
- [ ] **Шаг 2. Падающий контентный тест.** В `tests/content/lessons.test.ts` дописать `'types-casting'` в `GUIDE_LESSONS` (и вынести `MVP_LESSONS` отдельным списком, если это первый урок Ф11).
  Run: `pnpm test:content -t "урок types-casting"`
  Expected: FAIL, `нет урока types-casting`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: `~/Projects/digitaliziruy!/synopsis/topics/11._SQL_в_PostgreSQL/` урок 11.25; https://www.postgresql.org/docs/current/datatype.html и https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-TYPE-CASTS.
  Создать `content/lessons/05-types/01-types-casting.mdx` с этим текстом:

  `````mdx
  ---
  id: types-casting
  title: Типы и приведение
  chapter: types
  number: "5.1"
  order: 1
  dataset: bookstore
  board:
    tables: [public.book]
  initialQuery: |
    select title, price, pages from book;
  docs:
    - https://www.postgresql.org/docs/current/datatype.html
    - https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-TYPE-CASTS
  course: ["11.25"]
  tags: [типы, приведение, cast]
  ---

  <TlDr>У каждой колонки свой тип. Несовместимые типы Postgres не сравнивает: приводи явно через `::`.</TlDr>

  ## Что есть в данных

  <T id="public.book">book</T> уже знакома: 11 книг, 9 колонок. Особые строки те же, что в главе 4: у «Острова погибших кораблей» нет цены, у «Простого Python» нет автора. Теперь смотри не на строки, а на колонки: <C id="public.book.price">price</C> это numeric, <C id="public.book.pages">pages</C> это int, <C id="public.book.published_at">published_at</C> это date, <C id="public.book.tags">tags</C> это text[], массив строк. Тип подписан у каждой колонки на доске.

  ## Тип это договор

  Тип колонки отвечает на два вопроса: какие значения там живут и что с ними можно делать. Цену можно сложить с числом, а название нельзя:

  ```sql run expect=rows:1
  select title, price, pages, published_at, tags from book where book_id = 1;
  ```

  Одна строка, пять колонок, и в каждой значение своего типа. «Тихий Дон»: цена 890.00 numeric, 1504 страницы int, дата date, массив из двух строк.

  А теперь попробуем сравнить текст с числом:

  ```sql run expectError=42883
  select title from book where title = 5;
  ```

  Postgres отвечает: `operator does not exist: text = integer`. Так он говорит: «операции сравнения текста с числом не существует». Это не придирка: если бы текст можно было молча сравнивать с числом, половина ошибок в данных пряталась бы глубоко в результатах.

  <Callout kind="analogy">
  Розетки и вилки. Вилка европейской розетки не влезает в британскую: не потому что напряжение не подходит, а потому что форма другая. Типы это формы. Переходник это приведение типа.
  </Callout>

  ## Приведение через `::`

  Явное приведение записывается двойным двоеточием: `значение::тип`. То же самое длинно: `cast(значение as тип)`.

  Число в текст, чтобы склеить строки:

  ```sql run expect=rows:1
  select price::text || ' ₽' as label from book where book_id = 1;
  ```

  Текст в число, чтобы считать:

  ```sql run expect=rows:1
  select '42'::int + 1 as answer;
  ```

  Приведение это не «угадай, что я имел в виду». Если текст не похож на число, будет ошибка, и это честно:

  ```sql run expectError=22P02
  select 'abc'::int;
  ```

  Ошибка `22P02 invalid_text_representation` с текстом `invalid input syntax for type integer: "abc"`. Postgres не стал гадать, и хорошо.

  ## Когда Postgres приводит сам

  В некоторых местах приведение происходит неявно. Например, числовой литерал в кавычках сравнивается с numeric колонкой без твоего участия:

  ```sql run expect=rows:7
  select book_id, title, price from book where price > '500' order by book_id;
  ```

  Вернулось 7 строк: литерал `'500'` Postgres сам привёл к numeric. Удобно, но полагаться на это не стоит: неявные приведения есть не для каждой пары типов, и запрос с ними читается хуже. Правило простое: пишешь сравнение с «неудобным» литералом, приводи сам.

  ## Приведение и диапазон

  Знакомый фильтр из главы 4, теперь с пониманием типов: обе границы numeric, сравнение честное:

  ```sql run expect=rows:4
  select title, price from book where price > 500 and price < 1000 order by book_id;
  ```

  4 строки. Запомни это число: в главе про даты увидишь тот же приём с датами, где граница диапазона это уже не число.

  ## Чего нет в выдаче и почему

  - ❌ «Остров погибших кораблей» в обоих сравнениях по цене: `price` это NULL, а NULL не больше и не меньше числа. Урок 4.5 помнит.
  - ❌ Книги с ценой ровно 500 или 1000: их в данных и нет, границы строгие.
  - ❌ `title = 5`: нет такого оператора, `42883`.

  ## Ловушки

  <Callout kind="trap">
  `''` не приведётся к числу: `select ''::int` даст ту же `22P02`. Пустая строка это известный текст, а не «ноль как-нибудь». Если в колонке числа хранятся как text (бывает в legacy), NULL и пустые строки чинят до приведения: `nullif(col, '')::int`.
  </Callout>

  <Callout kind="tip">
  В продакшене типы колонок проверяют до того, как писать запрос: `select * from pg_catalog.pg_type`, а у нас тип подписан прямо на доске. Половина «странностей» в выдаче это неявное приведение, которое ты не заметил.
  </Callout>

  ## Проверь себя

  1. Сколько строк вернёт `select title from book where pages > 1000`? Сначала ответь, потом проверь на доске.
  2. Что вернёт `select '890.50'::numeric + 1`? А `select '890,50'::numeric + 1`?
  3. Приведи `pages` книги 1 к text и склей со словом «страниц»: сколько операторов приведения понадобилось?

  <Cheatsheet>
  - Тип колонки: какие значения и операции возможны. Несовместимое не сравнивается: `42883`.
  - Явное приведение: `x::тип` или `cast(x as тип)`. Кривой текст → `22P02`.
  - Числа к text приводят сами при `||`, литералы в сравнении с numeric тоже.
  - Правило: сомневаешься в типе, приводи явно.
  </Cheatsheet>
  `````

- [ ] **Шаг 4. Раннер зелёный.**
  Run: `pnpm test:content -t "урок types-casting"`
  Expected: PASS, 4 теста.
- [ ] **Шаг 5. Сцены глазами.**
  Run: `pnpm dev`, открыть `http://localhost:5199/l/types-casting`. Каждый пример нажать «На доску»: сцена совпадает с текстом, ошибка `42883` подчёркнута в редакторе. Пройти `<Cheatsheet>` и проверить наведение на `T`/`C`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.1\*\*/- ✅ ($(date +%F)) **L5\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/01-types-casting.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.1 «Типы и приведение»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 9. Урок 5.2 «Числа» (L5.2)

**Files:**
- Create: `content/lessons/05-types/02-numbers.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: то же, что в задаче 8.
- Числа-якоря (сверены): `7 / 2` → 3, `7::numeric / 2` → `3.5000000000000000`; `round(2.5)` → 3, `round(3.5)` → 4; `sum(price)` → `11380.00`, `avg(price)` → `1138.0000000000000000` (у 11 книг одна без цены); `0.1::float8 + 0.2::float8` → `0.30000000000000004`, приведение к numeric → `0.3`; `2147483647 + 1` → `22003`; `sum(qty * price)` по заказу 1 → `1730.00`; `pages::numeric / 100` книги 3 → `0.64000000000000000000`.

- [ ] **Шаг 1. Взять пункт в работу.**
  ```bash
  sed -i '' -E "s/^- ⬜ \*\*L5\.2\*\*/- 🔄 ($(date +%F)) **L5\.2**/" docs/PROGRESS.md
  ```
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'numbers'` в `GUIDE_LESSONS`.
  Run: `pnpm test:content -t "урок numbers"`
  Expected: FAIL, `нет урока numbers`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.26; https://www.postgresql.org/docs/current/datatype-numeric.html и https://www.postgresql.org/docs/current/functions-math.html.
  Создать `content/lessons/05-types/02-numbers.mdx` с этим текстом:

  `````mdx
  ---
  id: numbers
  title: Числа
  chapter: types
  number: "5.2"
  order: 2
  dataset: bookstore
  board:
    tables: [public.book]
  initialQuery: |
    select title, price, pages from book;
  docs:
    - https://www.postgresql.org/docs/current/datatype-numeric.html
    - https://www.postgresql.org/docs/current/functions-math.html
  course: ["11.26"]
  tags: [числа, integer, numeric, float, деление, округление]
  ---

  <TlDr>Целые и точные деньги это int и numeric. Дроби с плавающей точкой это float: быстрые, но с сюрпризами.</TlDr>

  ## Что есть в данных

  В <T id="public.book">book</T> два числовых колонки: <C id="public.book.price">price</C> numeric(10,2) и <C id="public.book.pages">pages</C> int. Цен нет у одной книги («Остров погибших кораблей»), в агрегатах она выпадает.

  ## Целое деление

  Два целых делятся нацело. Дробная часть выбрасывается, без округления:

  ```sql run expect=rows:1
  select 7 / 2 as int_div, 7::numeric / 2 as exact_div;
  ```

  Один и тот же запрос, два ответа: `3` и `3.5000000000000000`. Как только хотя бы один операнд numeric, деление точное. Это ловушка номер один: `pages / 100` для «средней толщины» даст 0 для тонких книг:

  ```sql run expect=rows:1
  select pages, pages::numeric / 100 as hundreds from book where book_id = 3;
  ```

  «Судьба человека»: 64 страницы и `0.64` сотни. Без `::numeric` было бы `0`.

  ## numeric: точные деньги

  numeric хранит число как есть: `11380.00` это ровно 11380.00, сколько бы раз ты его ни складывал. Поэтому цены и суммы живут в numeric.

  ```sql run expect=rows:1
  select sum(price) as total, avg(price) as middle from book;
  ```

  Сумма цен 11 книг: `11380.00`, средняя `1138.0000000000000000`. Обрати внимание: `avg` считает по 10 книгам, книга без цены не участвует. `count(*)` сказал бы 11.

  ## Округление

  numeric округляет половину от нуля, «школьным» правилом:

  ```sql run expect=rows:1
  select round(2.5) as r25, round(3.5) as r35;
  ```

  Оба вверх: 3 и 4. Это правило «половина от нуля», как в школе. Округление до нужного числа знаков: `round(x, 2)`. «Банковского» округления половины к чётному в Postgres нет.

  ## float: быстро, но приблизительно

  Дробные с плавающей точкой хранятся как двоичная дробь. Некоторые десятичные дроби в двоичной системе бесконечны, и получается вот это:

  ```sql run expect=rows:1
  select (0.1::float8 + 0.2::float8) as float_sum, (0.1::float8 + 0.2::float8)::numeric as exact_sum;
  ```

  `float_sum` это `0.30000000000000004`. Не ошибка, а свойство формата. Для научных расчётов, координат, процентов с допуском это нормально. Для денег нет.

  ```sql run expect=rows:1
  select price::float8 as approx_price from book where book_id = 1;
  ```

  890.00 превратилось в 890: float не хранит «два знака», он хранит «примерно это значение».

  ## Переполнение

  int это 32 бита: максимум 2147483647. Сумма страниц маленькой таблицы не переполнится, а вот счётчик событий в нагруженной системе может:

  ```sql run expectError=22003
  select 2147483647 + 1;
  ```

  `22003 numeric_value_out_of_range`. Для больших счётчиков есть bigint (8 байт), для identifier в больших таблицах его и берут.

  ## Деньги считаются в numeric

  Посчитаем выручку заказа 1: количество умножить на цену, всё в numeric:

  ```sql run expect=rows:1
  select sum(qty * price) as revenue from order_item where order_id = 1;
  ```

  `1730.00`: одна «Судьба человека» по 350 и две «Капитанские дочки» по 420. Ровно, до копейки.

  ## Чего нет в выдаче и почему

  - ❌ Книга без цены в `sum` и `avg`: NULL выпадает из агрегатов (кроме `count(*)`).
  - ❌ «0.64 сотни страниц» без `::numeric`: целое деление съело дробную часть.
  - ❌ `0.1 + 0.2 = 0.3` во float: равенство ложное, сравнивай с допуском или в numeric.

  ## Ловушки

  <Callout kind="trap">
  Целое деление подкрадывается в середину выражения: `bonus / 10 * 10` не вернёт исходное число. Если в выражении есть деление, а результат дробный по смыслу, приведи один операнд к numeric в самом начале.
  </Callout>

  <Callout kind="tip">
  Правила продакшена: деньги в numeric, счётчики в bigint, научные величины во float. Никогда не храни деньги во float: копейки будут «теряться» на ровном месте, как 0.00000000000000004 выше.
  </Callout>

  ## Проверь себя

  1. Сколько вернёт `select 5 / 2 * 2`? А `select 5::numeric / 2 * 2`?
  2. Почему `avg(price)` по 11 книгам посчитан по 10?
  3. Какой тип выбрать для поля «скидка в процентах с двумя знаками»?

  <Cheatsheet>
  - int / int → целое (дробная часть выбрасывается). numeric → точное.
  - numeric: деньги и всё, что должно сойтись до копейки.
  - float4/float8: быстро и приблизительно, `0.1 + 0.2 != 0.3`.
  - Переполнение int: `22003`. Большие счётчики: bigint.
  - NULL выпадает из sum/avg.
  </Cheatsheet>
  `````

- [ ] **Шаг 4. Раннер зелёный.**
  Run: `pnpm test:content -t "урок numbers"`
  Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/numbers`: примеры на доске, ошибка `22003` подчёркнута.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.2\*\*/- ✅ ($(date +%F)) **L5\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/02-numbers.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.2 «Числа»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 10. Урок 5.3 «Строки» (L5.3)

**Files:**
- Create: `content/lessons/05-types/03-strings.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: то же, что в задаче 8.
- Числа-якоря (сверены): `upper('тихий дон')` → «ТИХИЙ ДОН», `btrim('  привет  ')` → «привет»; `position('он' in 'Тихий Дон')` → 8; `left('Привет', 3)` → «При», `right('Привет', 2)` → «ет»; `format` книги 1 → «Тихий Дон (890.00 ₽)»; `ilike '%python%'` → 3 книги; `length('Привет')` → 6; `'ab'::char(5) || '|'` → «ab|», `length` → 2 (хвостовые пробелы срезаются при выходе в text).

- [ ] **Шаг 1. Взять пункт в работу.**
  ```bash
  sed -i '' -E "s/^- ⬜ \*\*L5\.3\*\*/- 🔄 ($(date +%F)) **L5\.3**/" docs/PROGRESS.md
  ```
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'strings'` в `GUIDE_LESSONS`.
  Run: `pnpm test:content -t "урок strings"`
  Expected: FAIL, `нет урока strings`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.27; https://www.postgresql.org/docs/current/datatype-character.html и https://www.postgresql.org/docs/current/functions-string.html.
  Создать `content/lessons/05-types/03-strings.mdx` с этим текстом:

  `````mdx
  ---
  id: strings
  title: Строки
  chapter: types
  number: "5.3"
  order: 3
  dataset: bookstore
  board:
    tables: [public.book, public.customer]
  initialQuery: |
    select title from book;
  docs:
    - https://www.postgresql.org/docs/current/datatype-character.html
    - https://www.postgresql.org/docs/current/functions-string.html
  course: ["11.27"]
  tags: [строки, text, varchar, char, ilike, format]
  ---

  <TlDr>Для строк в Postgres один рабочий тип: text. varchar и char не дают ничего, кроме проблем.</TlDr>

  ## Что есть в данных

  Названия книг в <C id="public.book.title">title</C> и имена покупателей в <C id="public.customer.name">name</C>: оба text. В именах есть полный тёзка: два «Ивана Петрова». В email кое-где смешан регистр, вернёмся к этому в главе про индексы.

  ## text против varchar и char

  Три строковых типа:

  - `text`: строка любой длины. Основной тип.
  - `varchar(n)`: то же text, но с ограничением длины `n`.
  - `char(n)`: дополняет значение пробелами до `n` символов при хранении.

  Проверим «дополнение пробелами» char:

  ```sql run expect=rows:1
  select 'ab'::char(5) || '|' as glued, length('ab'::char(5)) as len;
  ```

  Сюрприз: `glued` это `ab|`, а не `ab   |`. Хвостовые пробелы срезаются, как только значение выходит в text (а `||` возвращает text). Пробелы живут внутри char и мешают там, а снаружи их будто и нет. Отсюда правило ниже.

  <DontDoThis href="https://wiki.postgresql.org/wiki/Don't_Do_This#Don't_use_char(n)">
  Не используй `char(n)`. В Postgres он не «фиксирует ширину колонки», а молча добавляет и срезает пробелы. Для всего, что больше одного символа, бери `text`. Ограничение длины, если оно правда нужно бизнесу, выражай явно: `char varying(n)` или CHECK.
  </DontDoThis>

  ## Склейка и повтор

  Строки склеиваются оператором `||`:

  ```sql run expect=rows:1
  select 'Тихий' || ' ' || 'Дон' as full_title;
  ```

  Повтор и обрезка:

  ```sql run expect=rows:1
  select initcap('hello world') as titled, repeat('=', 10) as line;
  ```

  `initcap` поднимает первую букву каждого слова: «Hello World».

  ## Регистр и пробелы

  ```sql run expect=rows:1
  select upper('тихий дон') as up, lower('Python') as down, btrim('  привет  ') as trimmed;
  ```

  Сравнение строк регистрозависимо: `'ABC' = 'abc'` это false. Регистронезависимый поиск делает `ilike`:

  ```sql run expect=rows:3
  select title, price from book where title ilike '%python%' order by book_id;
  ```

  3 книги с «Python» в названии, в любом регистре.

  ## Куски строки

  ```sql run expect=rows:1
  select left('Привет', 3) as l, right('Привет', 2) as r, position('он' in 'Тихий Дон') as at;
  ```

  `left` и `right` отрезают по N символов, `position` ищет подстроку: «он» внутри «Тихий Дон» на позиции 8. Длина:

  ```sql run expect=rows:1
  select length('Привет') as chars;
  ```

  6 символов: `length` считает символы, а не байты. Для байтов есть `octet_length`, кириллица в UTF-8 занимает по 2 байта.

  ## format: строка из кусочков

  `format` собирает строку по шаблону, как sprintf:

  ```sql run expect=rows:1
  select format('%s (%s ₽)', title, price) as label from book where book_id = 1;
  ```

  «Тихий Дон (890.00 ₽)»: `%s` подставляет значение как text. Удобнее каскада `||`, когда кусочков много.

  ## Чего нет в выдаче и почему

  - ❌ Книги без «Python» в `ilike`-примере: подстроки нет.
  - ❌ «Тихий Дон» в `like '%python%'` (без i): регистр не совпал бы, пример был бы пуст.
  - ❌ Пробелы char(5): срезаны при выходе в text.

  ## Ловушки

  <Callout kind="trap">
  `like` не понимает регулярных выражений, только `%` и `_`. И следи за пробелами: `where email = 'a@b.ru'` не найдёт `'a@b.ru '`. Обрезай входные данные `btrim` или сравнивай с обрезкой.
  </Callout>

  <Callout kind="tip">
  В продакшене email и логины часто ищут без регистра: `where lower(email) = lower($1)`. Глава 12 покажет, как не убить этим производительность (индекс по выражению).
  </Callout>

  ## Проверь себя

  1. Что вернёт `select left(title, 7) from book where book_id = 1`?
  2. Сколько книг найдёт `title like '%о%'`? А с `ilike`?
  3. Как собрать строку «Покупатель N делает заказ M» из двух колонок через format?

  <Cheatsheet>
  - text везде, char(n) нигде (PG wiki). varchar(n) только если лимит реально нужен.
  - `||` склейка, `format('%s...', ...)` шаблон.
  - `upper/lower/initcap/btrim/left/right/position/length`.
  - `like` регистрозависим, `ilike` нет. `%` и `_`, не регэкспы.
  - length считает символы, octet_length байты.
  </Cheatsheet>
  `````

- [ ] **Шаг 4. Раннер зелёный.**
  Run: `pnpm test:content -t "урок strings"`
  Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/strings`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.3\*\*/- ✅ ($(date +%F)) **L5\.3**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/03-strings.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.3 «Строки»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 11. Урок 5.4 «Дата и время» (L5.4)

**Files:**
- Create: `content/lessons/05-types/04-dates-time.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: то же, что в задаче 8.
- Числа-якоря (сверены): заказ 7 по Москве `2024-05-01 00:10`, по UTC `2024-04-30 21:10`; `published_at + interval '90 days'` книги 7 (1926-01-01) → 1926-04-01; `extract(year ...)` книг 1 и 2 → 1940 и 2022; `date_trunc('month', ...)` книги 2 → 2022-03-01; `age` → `35 years 7 mons 17 days`; `'2024-02-31'::date` → `22008`.

- [ ] **Шаг 1. Взять пункт в работу.**
  ```bash
  sed -i '' -E "s/^- ⬜ \*\*L5\.4\*\*/- 🔄 ($(date +%F)) **L5\.4**/" docs/PROGRESS.md
  ```
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'dates-time'` в `GUIDE_LESSONS`.
  Run: `pnpm test:content -t "урок dates-time"`
  Expected: FAIL, `нет урока dates-time`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.29; https://www.postgresql.org/docs/current/datatype-datetime.html и https://www.postgresql.org/docs/current/functions-datetime.html.
  Создать `content/lessons/05-types/04-dates-time.mdx` с этим текстом:

  `````mdx
  ---
  id: dates-time
  title: Дата и время
  chapter: types
  number: "5.4"
  order: 4
  dataset: bookstore
  board:
    tables: [public.orders]
  initialQuery: |
    select order_id, created_at from orders;
  docs:
    - https://www.postgresql.org/docs/current/datatype-datetime.html
    - https://www.postgresql.org/docs/current/functions-datetime.html
  course: ["11.29"]
  tags: [дата, время, timestamp, timestamptz, interval, часовой пояс]
  ---

  <TlDr>date это день, timestamptz это момент с поясом, interval это «сколько-то». Сравнивай моменты, а не их текстовую запись.</TlDr>

  ## Что есть в данных

  У заказов в <C id="public.orders.created_at">created_at</C> стоит timestamptz, у книг в <C id="public.book.published_at">published_at</C> date. Все времена записаны со смещением `+03`. Особый заказ: номер 7, создан `2024-05-01 00:10+03`. По Москве это первое мая, а по UTC ещё тридцатое апреля. Запомни его.

  ## Три типа на каждый день

  - `date`: календарный день, без времени и пояса. `published_at` книги.
  - `timestamp`: момент без пояса. «13:05» и всё, чей это пояс, неизвестно.
  - `timestamptz`: момент с поясом. Хранится как UTC, показывается в поясе сессии. `created_at` заказов.

  ## Дата плюс интервал

  `interval` это длительность: дни, часы, минуты. Прибавляется к дате и времени:

  ```sql run expect=rows:1
  select published_at, (published_at + interval '90 days')::date as later from book where book_id = 7;
  ```

  «Остров погибших кораблей» вышел 1926-01-01, через 90 дней 1926-04-01. Читается как задачка про календарь, и Postgres решает её сам, включая високосные годы.

  ```sql run expect=rows:1
  select interval '1 day 2 hours' as i;
  ```

  ## Достать часть: extract и date_trunc

  `extract` достает поле (год, месяц, час) из даты:

  ```sql run expect=rows:2
  select book_id, extract(year from published_at) as year from book where book_id in (1, 2) order by book_id;
  ```

  1940 и 2022. `date_trunc` наоборот, обрубает всё мельче заданного поля:

  ```sql run expect=rows:1
  select date_trunc('month', published_at)::date as month_start from book where book_id = 2;
  ```

  Книга вышла 2022-03-01, начало месяца то же самое: всё после «месяца» стало нулями.

  ## Сколько прошло: age

  ```sql run expect=rows:1
  select age(timestamp '2026-01-01', timestamp '1990-05-15') as a;
  ```

  `35 years 7 mons 17 days`: age считает человеческую разницу, а не «дней: 13056».

  ## timestamptz: один момент, разная запись

  Возвращаемся к заказу 7. Один и тот же момент покажем в двух поясах:

  ```sql run expect=rows:1
  select order_id,
         to_char(created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') as msk,
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
  from orders where order_id = 7;
  ```

  По Москве `2024-05-01 00:10`, по UTC `2024-04-30 21:10`. Дата «заказа» зависит от пояса того, кто спрашивает. Поэтому «заказы за сутки» считай от явной границы в конкретном поясе:

  ```sql run expect=rows:1
  select to_char(created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD') as day_msk from orders where order_id = 7;
  ```

  В примерах урока пояс задан явно (`at time zone 'Europe/Moscow'`), чтобы ответ не зависел от настроек машины.

  <DontDoThis href="https://wiki.postgresql.org/wiki/Don't_Do_This#Don't_use_timestamp_without_time_zone">
  Для всего, что случилось «в реальном мире» (заказы, платежи, логи), бери `timestamptz`. Голый `timestamp` оставь для договорённых «настенных часов»: расписание смен, время будильника. И в запросах между датами используй полуинтервал `>= начало and < конец`, а не `between`: краевые секунды суток иначе теряются.
  </DontDoThis>

  ## Кривая дата

  Postgres проверяет даты на правдивость:

  ```sql run expectError=22008
  select '2024-02-31'::date;
  ```

  `22008 datetime_field_out_of_range`: тридцать первого февраля не бывает.

  ## Чего нет в выдаче и почему

  - ❌ Заказ 7 «первомайский» по UTC: он апрельский. Момент один, записи две.
  - ❌ `published_at` с временем: date хранит только день.
  - ❌ «90 дней» как число: только interval, days это не int.

  ## Ловушки

  <Callout kind="trap">
  Литерал `'2024-06-01'` в сравнении с timestamptz приводится в поясе сессии, а он разный у разработчика, теста и сервера. Пиши со смещением: `'2024-06-01 00:00+03'` или с явным `at time zone`. В наших примерах для заказов за сутки всегда смещение `+03`.
  </Callout>

  <Callout kind="tip">
  now() это момент начала транзакции, clock_timestamp() внутри неё. Для «когда создана строка» берём default now(): оно стабильно в рамках транзакции.
  </Callout>

  ## Проверь себя

  1. Сколько дней между `published_at` книг 1 и 2? Подсказка: вычти даты.
  2. Какой год у самой старой книги? `extract` плюс `order by ... limit 1`.
  3. Что вернёт `created_at at time zone 'Asia/Tokyo'` для заказа 7?

  <Cheatsheet>
  - date: день. timestamptz: момент с поясом. interval: длительность.
  - `+ interval '90 days'`, `extract(year from x)`, `date_trunc('month', x)`, `age(a, b)`.
  - `at time zone 'Europe/Moscow'`: перевод момента в настенное время города.
  - Литералы с датами в timestamptz: со смещением `+03` или явным поясом.
  - Сутки: `>= начало and < конец`, не `between`.
  - Кривая дата: `22008`.
  </Cheatsheet>
  `````

- [ ] **Шаг 4. Раннер зелёный.**
  Run: `pnpm test:content -t "урок dates-time"`
  Expected: PASS. Если «заказ 7» даёт другие часы: см. Global Constraints про часовой пояс сервера.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/dates-time`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.4\*\*/- ✅ ($(date +%F)) **L5\.4**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/04-dates-time.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.4 «Дата и время»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 12. Урок 5.5 «boolean» (L5.5)

**Files:**
- Create: `content/lessons/05-types/05-boolean.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Consumes: то же, что в задаче 8. Этот урок завершает цепочку про трёхзначную логику из 4.5.
- Числа-якоря (сверены): у 3 из 6 покупателей `bonus > 0`; `true and null` → NULL, `false and null` → false, `true or null` → true, `false or null` → NULL; `count(*) filter (where bonus > 0)` → 3 при `count(*)` 6; `bonus between 100 and 200` → 1 покупатель; `city is distinct from null` → 5.

- [ ] **Шаг 1. Взять пункт в работу.**
  ```bash
  sed -i '' -E "s/^- ⬜ \*\*L5\.5\*\*/- 🔄 ($(date +%F)) **L5\.5**/" docs/PROGRESS.md
  ```
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'boolean'` в `GUIDE_LESSONS`.
  Run: `pnpm test:content -t "урок boolean"`
  Expected: FAIL, `нет урока boolean`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.30; https://www.postgresql.org/docs/current/datatype-boolean.html.
  Создать `content/lessons/05-types/05-boolean.mdx` с этим текстом:

  `````mdx
  ---
  id: boolean
  title: boolean
  chapter: types
  number: "5.5"
  order: 5
  dataset: bookstore
  board:
    tables: [public.customer]
  initialQuery: |
    select name, bonus from customer;
  docs:
    - https://www.postgresql.org/docs/current/datatype-boolean.html
  course: ["11.30"]
  tags: [boolean, true, false, null, filter, is distinct from]
  ---

  <TlDr>boolean это true, false и NULL. AND и OR с NULL подчиняются таблице, которую надо один раз увидеть.</TlDr>

  ## Что есть в данных

  У покупателей есть <C id="public.customer.bonus">bonus</C>: целое число, 0 и больше (CHECK следит). «Есть бонус» это уже не колонка, а выражение `bonus > 0`. У троих из шести есть. У одной покупательницы нет города: NULL возвращается.

  ## Значение true и false в выражении

  Сравнение и вычисление прямо в SELECT: выражение это тоже колонка:

  ```sql run expect=rows:6
  select name, bonus > 0 as has_bonus from customer order by customer_id;
  ```

  Шесть строк, в колонке `has_bonus` true/false. На доске видно, как выражение вычисляется построчно.

  ## Таблица AND и OR с NULL

  В уроке 4.5 ты уже видел, что NULL портит сравнения. Вот полная таблица для AND и OR:

  ```sql run expect=rows:1
  select true and null as tan, false and null as fan, true or null as ton, false or null as fon;
  ```

  Четыре ответа: NULL, false, true, NULL. Правило: AND идёт к «худшему» (false бьёт NULL), OR к «лучшему» (true бьёт NULL). Остальные восемь клеток таблицы без NULL и скучны.

  ## FILTER: счёт по условию

  Агрегат с `filter` считает только строки, прошедшие условие:

  ```sql run expect=rows:1
  select count(*) filter (where bonus > 0) as with_bonus, count(*) as total from customer;
  ```

  3 из 6. Это то же самое, что `count(case when bonus > 0 then 1 end)`, но читается по-человечески.

  ## Диапазон и отдельные значения

  ```sql run expect=rows:1
  select name from customer where bonus between 100 and 200;
  ```

  Один покупатель в диапазоне. `between` это сокращение для `>= and <=`, с NULL внутри он ведёт себя так же коварно.

  ## Сравнение с NULL: is distinct from

  Обычное `city <> null` даёт NULL и строку отбрасывает. Если нужно честное «значение отличается от NULL»:

  ```sql run expect=rows:1
  select count(*) as with_city from customer where city is distinct from null;
  ```

  5 покупателей с городом. `is distinct from` это сравнение, в котором NULL это обычное значение: «не равно NULL». Слева направо читается редкая честная проверка.

  ```sql run expect=rows:6
  select name, coalesce(city, 'не указан') as city from customer order by customer_id;
  ```

  coalesce заменяет NULL на запасное значение: очередь из 4.5 закрепляется.

  ## Чего нет в выдаче и почему

  - ❌ Покупатель без города в `city is distinct from null`: NULL это не значение, «distinct от null» ложен.
  - ❌ Строки с NULL-бонусом в `where bonus > 0`: таких в датасете нет (CHECK требует не меньше 0), но в таблице с NULL-бонусом они молча выпали бы и из `bonus > 0`, и из `not (bonus > 0)`.
  - ❌ «Пять без города» через `city <> null`: сравнение с NULL всегда NULL, строк нет; работает только `is distinct from`.

  ## Ловушки

  <Callout kind="trap">
  `where not (bonus > 0)` не противоположность `where bonus > 0`, если bonus бывает NULL: NOT(NULL) это NULL, строка уйдёт из обеих выборок. Проверяй NULL отдельным условием или `is distinct from`.
  </Callout>

  <Callout kind="tip">
  В продакшене булевы флаги называют по действию: `is_active`, `has_discount`, `notify`. «Не-флаги» (`not_active`) заставляют читать условение с переворотом, ошибки плодятся именно там.
  </Callout>

  ## Проверь себя

  1. Что вернёт `select count(*) from customer where not (bonus > 0)`? А сколько строк потерялось бы, если бы у кого-то bonus был NULL? Сначала руками, потом доска.
  2. Сколько покупателей с `city is distinct from 'Москва'`? Чем отличается от `city <> 'Москва'`?
  3. `select null and null`? Сначала таблица, потом доска.

  <Cheatsheet>
  - boolean: true, false, NULL. NULL в булевом контексте = «не знаю».
  - AND к худшему (false > NULL > true по «ложности»), OR к лучшему.
  - `count(*) filter (where ...)`: счёт по условию без подзапроса.
  - `is distinct from`: сравнение, где NULL обычное значение.
  - NOT от NULL это NULL: «не условие» теряет NULL-строки.
  </Cheatsheet>
  `````

- [ ] **Шаг 4. Раннер зелёный.**
  Run: `pnpm test:content -t "урок boolean"`
  Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/boolean`: у `has_bonus` в сцене видно true/false по строкам.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.5\*\*/- ✅ ($(date +%F)) **L5\.5**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/05-boolean.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.5 «boolean»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 13. Урок 5.6 «enum» (L5.6)

С этого урока и до конца главы брифы сжатые: полный текст пишется по `docs/content-style.md`, здесь опорные тезисы и все sql-блоки с ожиданиями.

**Files:**
- Create: `content/lessons/05-types/06-enum.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `enum_range(null::order_status)` → `{new,paid,shipped,cancelled}`; статусы: new 2, paid 4, shipped 1, cancelled 1; `order by status` сначала new, потом paid (порядок объявления, не алфавит); `insert ... values (6, 'payed')` → `22P02`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L5\.6\*\*/- 🔄 ($(date +%F)) **L5\.6**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'enum'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок enum"`. Expected: FAIL, `нет урока enum`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.28; https://www.postgresql.org/docs/current/datatype-enum.html.
  Тезисы урока:
  - enum это список строк, зафиксированный на уровне типа. В датасете уже есть: <C id="public.orders.status">status</C> у заказов.
  - Список значений: `enum_range(null::order_status)`. Порядок значений задаётся при создании типа и влияет на сортировку.
  - Статусы в данных: 4 группы, числа-якоря.
  - Сортировка по статусу идёт в порядке объявления, а не по алфавиту.
  - Опечатка в значении это ошибка, а не «просто строка»: `22P02`.
  - Сравнить с text: enum компактнее и честнее CHECK? Разбор: CHECK гибче (легко добавить значение), enum даёт порядок и не даст мусор.
  - Изменение списка: `alter type ... add value` (в PGlite работает, но после добавления значения в той же транзакции использовать его нельзя; в уроке отдельный apply-блок).
  - Текст с числами-якорями, аналогия (светофор: конечный набор состояний), ловушка (значение вне списка уронит вставку целого пакета строк).
  Sql-блоки урока (все с ожиданиями, ключевые целиком):
  ```sql run expect=rows:1
  select enum_range(null::order_status) as statuses;
  ```
  ```sql run expect=rows:4
  select status, count(*) as n from orders group by status order by status;
  ```
  ```sql run expect=rows:3
  select status, order_id from orders order by status, order_id limit 3;
  ```
  ```sql run expectError=22P02
  insert into orders (customer_id, status) values (6, 'payed');
  ```
  (последний: run-блок, превью откатит вставку)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок enum"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/enum`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.6\*\*/- ✅ ($(date +%F)) **L5\.6**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/06-enum.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.6 «enum»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 14. Урок 5.7 «Массивы» (L5.7)

Первый урок, где работает сцена `expand` из задач 6-7: массив «взрывается» в строки. Все примеры с `unnest` обязаны давать трассу `full`.

**Files:**
- Create: `content/lessons/05-types/07-arrays.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `tags` книги 1 → `{классика,роман}`; тег `python` через `@>` у 3 книг (2, 10, 11); `'beginner' = any(tags)` у 2 книг (10, 11); `unnest` тегов книги 5 → 3 строки; `array_length(tags, 1)` по всем книгам от 1 до 3; `array_agg(distinct unnest(tags))` → `0A000`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L5\.7\*\*/- 🔄 ($(date +%F)) **L5\.7**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'arrays'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок arrays"`. Expected: FAIL, `нет урока arrays`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.31; https://www.postgresql.org/docs/current/arrays.html.
  Тезисы урока:
  - text[]: список значений в одной ячейке. У книг это <C id="public.book.tags">tags</C>.
  - Чтение элемента: `tags[1]`, размер: `array_length(tags, 1)` / `cardinality(tags)`.
  - Проверка «есть ли тег»: `tags @> '{python}'` (содержит) и `'beginner' = any(tags)` (равен хоть одному). Числа-якоря.
  - Раскрытие в строки: `unnest` в FROM. На доске: ячейка-массив взрывается в 3 строки, скобка связывает потомков с книгой. Это главная сцена урока.
  - Сравнение с «правильной» связующей таблицей: массив нельзя JOIN-ить наружу без unnest, индексы GIN (глава 12) частично спасают.
  - Ловушка: `array_agg(distinct unnest(tags))` не работает (агрегат + set-returning в одном выражении), `0A000`.
  - Массив в SELECT-списке (без FROM-таблицы) покажем как final-only с причиной.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select title, tags from book where book_id = 1;
  ```
  ```sql run expect=rows:11
  select book_id, array_length(tags, 1) as n from book order by book_id;
  ```
  ```sql run expect=rows:3
  select book_id, title from book where tags @> '{python}' order by book_id;
  ```
  ```sql run expect=rows:2
  select book_id, title from book where 'beginner' = any(tags) order by book_id;
  ```
  ```sql run expect=rows:3
  select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5;
  ```
  ```sql run expect=rows:3
  select b.title, u.tag from book b, unnest(b.tags) as u(tag) where u.tag = 'python' order by b.book_id;
  ```
  (у каждой из трёх книг с тегом `python` ровно одна строка-потомок с этим тегом)
  ```sql run expectError=0A000
  select array_agg(distinct unnest(tags)) as all_tags from book;
  ```
  ```sql run trace=final-only expect=rows:3
  select unnest(tags) as tag from book where book_id = 5;
  ```
  (над блоком комментарий `{/* final-only: set-returning функция в списке SELECT */}`)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок arrays"`. Expected: PASS, трасса `unnest`-блоков `full`.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/arrays`: сцена взрыва массива у блока с `unnest`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.7\*\*/- ✅ ($(date +%F)) **L5\.7**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/07-arrays.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.7 «Массивы»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 15. Урок 5.8 «JSON и JSONB» (L5.8)

Вторая сцена `expand`: jsonb-документ раскрывается в колонки и строки.

**Files:**
- Create: `content/lessons/05-types/08-jsonb.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `meta` книги 1 → `{"lang": "ru", "format": "hardcover"}`; `meta->>'format'` при `meta ? 'format'` у 2 книг (1, 2); `meta @> '{"lang": "ru"}'` у 7 книг; `jsonb_each` настроек покупателя 1 → 2 строки (lang, notify); у покупателя 2 одна пара; `jsonb_array_elements('[1,2,3]')` → 3 строки; `meta->'edition'` книги 2 → `2` (jsonb), `meta->>'edition'` → `2` (text).

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L5\.8\*\*/- 🔄 ($(date +%F)) **L5\.8**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'jsonb'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок jsonb"`. Expected: FAIL, `нет урока jsonb`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.32 и 11.33; https://www.postgresql.org/docs/current/datatype-json.html.
  Тезисы урока:
  - json хранит текст как есть, jsonb разбирает в двоичное дерево: медленнее вставка, быстрее чтение, ключи сортированы, дубли схлопываются. Брать jsonb.
  - У книг есть <C id="public.book.meta">meta</C> jsonb: у части книг NULL, у покупательниц <C id="public.customer.settings">settings</C>.
  - Операторы: `->` (jsonb), `->>` (text), `?` (ключ есть), `@>` (содержит документ). Разница `->` и `->>` на примере `edition` книги 2: `2` это jsonb-число, `2` это текст.
  - Отсутствующий ключ: `->>` даёт NULL. Проверка через `?`.
  - Содержит: `meta @> '{"lang": "ru"}'` у 7 книг, числа-якоря.
  - Раскрытие документа: `jsonb_each` в FROM (пары ключ-значение, сцена «колонки key/value выращиваются из ячейки»), `jsonb_array_elements` (строки).
  - Сборка: `jsonb_build_object`.
  - Ловушка: индексов на `->>` нет «из коробки», для поиска нужен GIN по выражению (глава 12); NULL и «нет ключа» различаются только через `?`.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select title, meta from book where book_id = 1;
  ```
  ```sql run expect=rows:2
  select book_id, meta->>'format' as format from book where meta ? 'format' order by book_id;
  ```
  ```sql run expect=rows:1
  select meta->'edition' as edition_jsonb, meta->>'edition' as edition_text from book where book_id = 2;
  ```
  ```sql run expect=rows:7
  select book_id from book where meta @> '{"lang": "ru"}' order by book_id;
  ```
  ```sql run expect=rows:2
  select c.customer_id, s.key, s.value from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 1;
  ```
  ```sql run expect=rows:1
  select c.customer_id, s.key from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 2;
  ```
  ```sql run expect=rows:3
  select e.elem from (values ('[1,2,3]'::jsonb)) as j (doc), jsonb_array_elements(j.doc) as e (elem);
  ```
  ```sql run expect=rows:1
  select jsonb_build_object('title', title, 'cheap', price < 1000) as info from book where book_id = 1;
  ```
  ```sql run expect=rows:1
  select settings from customer where customer_id = 2;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок jsonb"`. Expected: PASS, трассы `jsonb_each`/`jsonb_array_elements`-блоков `full`.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/jsonb`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.8\*\*/- ✅ ($(date +%F)) **L5\.8**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/08-jsonb.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.8 «JSON и JSONB»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 16. Урок 5.9 «UUID и выбор первичного ключа» (L5.9)

**Files:**
- Create: `content/lessons/05-types/09-uuid-pk.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `gen_random_uuid()` выдаёт разные значения при каждом вызове (сравнение двух вызовов → false); `md5('a')` → `0cc175b9c0f1b6a831c399e269772661`; в bookstore все PK это bigint identity, `count(*)` по book → 11.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L5\.9\*\*/- 🔄 ($(date +%F)) **L5\.9**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'uuid-pk'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок uuid-pk"`. Expected: FAIL, `нет урока uuid-pk`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.37-12.39; https://www.postgresql.org/docs/current/datatype-uuid.html и https://www.postgresql.org/docs/current/ddl-constraints.html.
  Тезисы урока:
  - uuid: 128-битный идентификатор, `gen_random_uuid()` без внешних расширений. Два вызова дают разные значения, это и есть суть.
  - Выбор PK: bigint identity (компактный, сортируется, «считает» порядок) против uuid (генерится на клиенте, не светит число записей, не конфликтует при слиянии баз).
  - Размер: 8 байт против 16, и каждый вторичный индекс тянет ключ за собой: для больших таблиц разница заметна.
  - «Дырки» и порядок: identity монотонен, uuid v4 случаен: вставки размазываются по индексу, страницы греются равномернее, но диапазонные выборки бесполезны. Для uuid есть v7 (сортируемые), в 18-м Postgres доступен `uuidv7()`: упомянуть и показать noexec-блоком.
  - Где что: локальная автономная таблица: identity; распределённая генерация или слияние источников: uuid.
  - `md5`/`sha256` как «почти идентификатор»: удобны для дедупликации контента, но это хэш, не идентичность.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select gen_random_uuid() as u, gen_random_uuid() = gen_random_uuid() as same;
  ```
  ```sql run expect=rows:1
  select md5('a') as m;
  ```
  ```sql run expect=rows:11
  select count(*) as n from book;
  ```
  ```sql noexec
  create table event (
    event_id uuid default uuidv7() primary key,
    payload jsonb
  );
  ```
  (noexec: uuidv7 это блок про новую версию, выполнять не нужно)
  ```sql run expect=rows:1
  select book_id, pg_typeof(book_id)::text as type from book where book_id = 1;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок uuid-pk"`. Expected: PASS (ожидание `gen_random_uuid` только на число строк, значения случайны).
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/uuid-pk`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L5\.9\*\*/- ✅ ($(date +%F)) **L5\.9**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/05-types/09-uuid-pk.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 5.9 «UUID и выбор первичного ключа»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 17. VIEW и MATERIALIZED VIEW на доске (P11.3)

Спека 4: VIEW это «таблица-окно со стеклянной рамкой, внутри запрос, под ним живые таблицы». MATERIALIZED VIEW рисуется как снимок с бейджем отставания до REFRESH. Данные для отставания считает Postgres (Review Focus 5).

**Files:**
- Create: `src/features/db/views.ts`, `src/features/db/views.test.ts`
- Modify: `src/features/db/introspect.ts` (заполнение `viewDeps` и `matviewLag`), `src/features/board/model.ts` (рёбра зависимостей view), `src/features/board/TableNode.tsx` (стеклянная рамка), `src/features/board/layout.ts`
- Test: `src/features/board/TableNode.view.test.tsx`

**Interfaces:**
```ts
// views.ts
export async function matviewLag(db: DbClient, mv: TableInfo): Promise<number | null>;
// внутри preview: create temp table __vs_lag as <определение матвью>,
// lag = count((select * from mv) except all (select * from __vs_lag))
//      + count((select * from __vs_lag) except all (select * from mv)); null = определение не прочиталось
export async function viewDefinition(db: DbClient, viewId: string): Promise<string | null>;
```

- [ ] **Шаг 1. Падающий тест.** `src/features/db/views.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { introspect } from './introspect';
  import { matviewLag } from './views';
  import { withDataset } from '../../../tests/helpers/db';

  describe('views и matview', () => {
    it('интроспекция: виды, зависимости и отставание матвью', async () => {
      await withDataset('bookstore', async (db) => {
        await db.exec(`
          create view v_expensive as select book_id, title, price from book where price > 1000;
          create materialized view mv_expensive as select book_id, title, price from book where price > 1000;
        `);
        const schema = await introspect(db);
        expect(schema.tables.find((t) => t.id === 'public.v_expensive')?.kind).toBe('view');
        const matview = schema.tables.find((t) => t.id === 'public.mv_expensive');
        expect(matview?.kind).toBe('matview');
        // зависимость: вьюха и матвью смотрят на public.book
        expect(schema.viewDeps).toContainEqual({ viewId: 'public.v_expensive', tableId: 'public.book' });
        expect(schema.viewDeps).toContainEqual({ viewId: 'public.mv_expensive', tableId: 'public.book' });
        // свежее матвью не отстаёт
        expect(await matviewLag(db, matview!)).toBe(0);
        // появилась новая дорогая книга: в таблице она есть, в снимке нет
        await db.exec("insert into book (title, price) values ('Новая дорогая книга', 5000)");
        expect(await matviewLag(db, matview!)).toBe(1);
        await db.exec('refresh materialized view mv_expensive');
        expect(await matviewLag(db, matview!)).toBe(0);
      });
    }, 60_000);
  });
  ```
  (`matviewLag` сам оборачивает сравнение в транзакцию с откатом: временная таблица исчезает, данных не остаётся. При вызове из интроспекции внутри уже открытой транзакции использовать SAVEPOINT.)
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/views.test.ts`. FAIL: `matviewLag` не существует, `viewDeps` не заполняется.
- [ ] **Шаг 3. Код.**
  - `views.ts`: `viewDefinition` читает `pg_views.definition` / `pg_matviews.definition`; `matviewLag` выполняет сравнение через `except all` в обе стороны (одним запросом с подсчётом обеих сторон; определение оборачивать в скобки). Считает только Postgres, JS складывает два числа.
  - `introspect.ts`: `viewDeps` из каталога:
    ```sql
    select distinct v.relname, t.relname
    from pg_rewrite r
    join pg_depend d on d.objid = r.oid and d.deptype = 'n'
    join pg_class v on v.oid = r.ev_class and v.relkind in ('v', 'm')
    join pg_class t on t.oid = d.refobjid and t.relkind = 'r'
    join pg_namespace n on n.oid = v.relnamespace and n.nspname = current_schema()
    ```
    (имена схем приставить к id; временные таблицы отфильтровать). `matviewLag` заполняется только для `kind: 'matview'` и только когда интроспекцию вызвали из `sandbox.preview` (см. контракт «introspect вызывается только внутри sandbox.preview»): сравнение тоже внутри этой транзакции.
  - `TableNode.tsx`: для `kind: 'view'` рамка «стеклянная»: полупрозрачный фон, тонкая рамка, иконка глаза, в шапке подзаголовок «view»; для `kind: 'matview'` иконка снимка и бейдж: `matviewLag > 0` → «отстаёт на N строк» (жёлтый), иначе «свежий» (зелёный). NULL → бейджа нет.
  - `model.ts`: рёбра `viewDeps` рисуются пунктиром (без «вороньей лапки», это не FK), идут от таблицы к вьюхе.
- [ ] **Шаг 4. Тесты.** `views.test.ts` PASS; `TableNode.view.test.tsx` (dom): рендер TableNode с kind 'view' даёт класс стеклянной рамки и подпись «view»; с matview и `matviewLag: 3` текст «отстаёт на 3 строк». `pnpm check`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.3` → `✅ (<дата>)`.
  ```bash
  git add src/features/db/views.ts src/features/db/views.test.ts src/features/db/introspect.ts src/features/board/model.ts src/features/board/layout.ts src/features/board/TableNode.tsx src/features/board/TableNode.view.test.tsx docs/PROGRESS.md
  git commit -m "feat(board): VIEW стеклянной рамкой и MATERIALIZED VIEW с отставанием

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 18. Урок 10.1 «VIEW» (L10.1)

**Files:**
- Create: `content/lessons/10-views/01-view.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `price > 1000` у 3 книг (2, 10, 11); после `update book set price = 1500 where book_id = 6` дорогих книг 4; `pg_views` даёт 1 строку на вьюху.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L10\.1\*\*/- 🔄 ($(date +%F)) **L10\.1**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'view'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок view"`. Expected: FAIL, `нет урока view`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.6; https://www.postgresql.org/docs/current/sql-createview.html и https://www.postgresql.org/docs/current/tutorial-views.html.
  Тезисы урока:
  - VIEW это сохранённый запрос с именем. Данных не хранит: каждый SELECT из вьюхи выполняет запрос заново.
  - Создание через apply-блок (DDL), чтение обычными run-блоками.
  - На доске: вьюха рисуется стеклянной рамкой, пунктирная связь с <T id="public.book">book</T>: «под стеклом живые данные».
  - Живость: обновили цену книги 6 на 1500, вьюха тут же видит 4 строки вместо 3. Числа-якоря.
  - Зачем: переиспользуемые выборки, права (дать доступ к части колонок), совместимый интерфейс при рефакторинге таблиц.
  - `pg_views` показывает определение.
  - Ловушка: вьюха над вьюхой размывает происхождение; `select *` в определении вьюхи замораживает «*» на момент создания? Нет, но при `alter table` добавятся колонки и «взорвут» старые запросы. Формулировку сверить с докой.
  - `create or replace view`, `drop view`.
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create view expensive_book as select book_id, title, price from book where price > 1000;
  ```
  ```sql run expect=rows:3
  select * from expensive_book order by book_id;
  ```
  ```sql run expect=rows:2
  select book_id, title from expensive_book where price > 2000 order by book_id;
  ```
  ```sql run expect=rows:1
  select schemaname, viewname from pg_views where viewname = 'expensive_book';
  ```
  ```sql apply expect=rows:1
  update book set price = 1500 where book_id = 6 returning title, price;
  ```
  ```sql run expect=rows:4
  select count(*) as n from expensive_book;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок view"`. Expected: PASS (apply-блоки коммитятся по порядку, блоки после update видят 4 строки).
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/view`: стеклянная рамка вьюхи на доске, после apply-update бейдж строк вьюхи меняется.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L10\.1\*\*/- ✅ ($(date +%F)) **L10\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/10-views/01-view.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 10.1 «VIEW»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 19. Урок 10.2 «MATERIALIZED VIEW и REFRESH» (L10.2)

**Files:**
- Create: `content/lessons/10-views/02-materialized-view.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): дорогих книг 3; после `update book set price = 1500 where book_id = 6`: в таблице 4, в матвью по-прежнему 3, после `refresh` 4; `matviewLag` на доске: 1.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L10\.2\*\*/- 🔄 ($(date +%F)) **L10\.2**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'materialized-view'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок materialized-view"`. Expected: FAIL, `нет урока materialized-view`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.6; https://www.postgresql.org/docs/current/sql-creatematerializedview.html и https://www.postgresql.org/docs/current/rules-materializedviews.html.
  Тезисы урока:
  - MATERIALIZED VIEW хранит результат запроса как таблицу-снимок. SELECT из неё читает снимок, не пересчитывая запрос.
  - Создание: apply-блок. На доске: снимок с бейджем «свежий».
  - Отставание: обновили цену книги 6, таблица видит 4, снимок всё ещё 3. На доске бейдж «отстаёт на 1 строк» (задача 17).
  - `refresh materialized view`: пересчёт одним махом, бейдж снова «свежий». Без `concurrently` читатели ждут: обсудить.
  - `refresh materialized view concurrently` требует уникальный индекс: noexec-блок, в PGlite работает? Проверить при написании: если падает, noexec с пояснением.
  - Когда что: тяжёлый агрегат, который читают часто, а пересчитывать можно редко: матвью; живая логика: вью.
  - Индексы на матвью строятся как на таблицу: `create index on expensive_mv (price)` (apply).
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create materialized view expensive_mv as select book_id, title, price from book where price > 1000;
  ```
  ```sql run expect=rows:3
  select count(*) as n from expensive_mv;
  ```
  ```sql apply expect=rows:1
  update book set price = 1500 where book_id = 6 returning title, price;
  ```
  ```sql run expect=rows:4
  select count(*) as n from book where price > 1000;
  ```
  ```sql run expect=rows:3
  select count(*) as n from expensive_mv;
  ```
  ```sql apply expect=rows:0
  refresh materialized view expensive_mv;
  ```
  ```sql run expect=rows:4
  select count(*) as n from expensive_mv;
  ```
  ```sql apply expect=rows:0
  create index on expensive_mv (price);
  ```
  ```sql noexec
  refresh materialized view concurrently expensive_mv;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок materialized-view"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/materialized-view`: бейдж отставания после update и «свежий» после refresh.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L10\.2\*\*/- ✅ ($(date +%F)) **L10\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/10-views/02-materialized-view.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 10.2 «MATERIALIZED VIEW и REFRESH»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 20. Плеер шагов и MVCC-страница (P11.4)

Теоретические сцены (MVCC, B-дерево, лексемы, нормализация) проигрываются локальным плеером шагов в MDX-колонке. Данные у настоящего Postgres. MVCC-сцена особая: она показывает изменения версий, которые нельзя получить в `BEGIN ... ROLLBACK` (VACUUM запрещён в транзакции, 25001), поэтому сцена работает на собственных таблицах через `sandbox.client()` в autocommit и убирает их за собой. Отклонение от шапки «данные через sandbox.preview» осознанное, занесено в «Отклонения от контрактов» в конце плана: пользовательские данные урока сцена не трогает.

**Files:**
- Create: `src/features/scenes/useStepper.ts`, `src/features/scenes/MiniTable.tsx`, `src/features/scenes/mvcc-scene.ts`, `src/features/db/pageinspect.ts`, `src/features/db/pageinspect.test.ts`, `src/features/lessons/mdx/MvccPage.tsx`
- Modify: `src/features/lessons/mdx/components.ts`, `tests/content/lessons.test.ts` (MDX_TAGS), `src/stores/scene.ts` если плееру нужен общий стор (нет: плеер локальный)

**Interfaces:**
```ts
// pageinspect.ts
export interface RawVersion { lp: number; lpFlags: number; xmin: number; xmax: number; ctid: string | null }
export type VersionState = 'live' | 'dead' | 'aborted' | 'locked' | 'unused' | 'redirect';
export interface XidFacts { committed: number[]; aborted: number[]; lockers: number[] }
export function classifyVersions(items: RawVersion[], facts: XidFacts): Array<{ lp: number; state: VersionState }>;
export async function readHeapPage(db: DbClient, tableId: string, page: number): Promise<RawVersion[]>;

// useStepper.ts
export function useStepper(count: number): { index: number; next(): void; prev(): void };

// mvcc-scene.ts
export interface MvccStep { caption: string; versions: RawVersion[]; facts: XidFacts; visible: Array<{ id: string; val: string }> }
export async function runMvccScene(client: DbClient): Promise<MvccStep[]>;
```

Правила классификации (проверено на PGlite 18.3 2026-10-08): `lpFlags` 0 → `unused`, 2 → `redirect`, 3 → мёртвый указатель; иначе: `xmax = 0` → `live`; `xmin` в `aborted` → `dead` (версия откатанной вставки); `xmax` в `committed` → `dead` (старая версия после update/delete); `xmax` в `lockers` → `live` (только блокировка, строка жива); прочее → `live`.

- [ ] **Шаг 1. Падающий тест.** `src/features/db/pageinspect.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { createNodeClient } from './node-client';
  import { classifyVersions, readHeapPage } from './pageinspect';
  import { runMvccScene } from '../scenes/mvcc-scene';

  describe('pageinspect: классификация версий', () => {
    it('чистая классификация без базы', () => {
      const items = [
        { lp: 1, lpFlags: 1, xmin: 100, xmax: 0, ctid: '(0,1)' },
        { lp: 2, lpFlags: 1, xmin: 100, xmax: 101, ctid: '(0,4)' },
        { lp: 3, lpFlags: 1, xmin: 102, xmax: 0, ctid: '(0,3)' },
        { lp: 4, lpFlags: 1, xmin: 101, xmax: 0, ctid: '(0,4)' },
        { lp: 5, lpFlags: 0, xmin: 0, xmax: 0, ctid: null },
        { lp: 6, lpFlags: 2, xmin: 0, xmax: 0, ctid: null },
      ];
      expect(classifyVersions(items, { committed: [101], aborted: [102], lockers: [] })).toEqual([
        { lp: 1, state: 'live' },
        { lp: 2, state: 'dead' },
        { lp: 3, state: 'dead' },
        { lp: 4, state: 'live' },
        { lp: 5, state: 'unused' },
        { lp: 6, state: 'redirect' },
      ]);
      // xmax-блокировка не убивает строку
      expect(classifyVersions(
        [{ lp: 1, lpFlags: 1, xmin: 100, xmax: 105, ctid: '(0,1)' }],
        { committed: [], aborted: [], lockers: [105] },
      )).toEqual([{ lp: 1, state: 'locked' }]);
    });

    it('сцена MVCC: живые, мёртвые, откатанные, блокировка и vacuum (Review Focus 3)', async () => {
      const db = await createNodeClient();
      try {
        await db.exec('create extension pageinspect');
        const steps = await runMvccScene(db);
        // 6 шагов: старт, update, delete, откат, блокировка FK, vacuum
        expect(steps.length).toBe(6);
        const afterUpdate = steps[1]!;
        const st = new Map(classifyVersions(afterUpdate.versions, afterUpdate.facts).map((c) => [c.lp, c.state]));
        // у строки 1 старая версия мертва, новая живая
        expect([...st.values()].filter((s) => s === 'dead').length).toBe(1);
        expect([...st.values()].filter((s) => s === 'live').length).toBe(3);
        const afterRollback = steps[3]!;
        const st2 = classifyVersions(afterRollback.versions, afterRollback.facts);
        // мёртвые: старая версия update (lp1), delete (lp2) и вставка откатанной транзакции (lp5);
        // исходная строка 3 с откатанным xmax жива
        expect(st2.filter((s) => s.state === 'dead').length).toBeGreaterThanOrEqual(3);
        const afterVacuum = steps[5]!;
        const st3 = classifyVersions(afterVacuum.versions, afterVacuum.facts);
        // после vacuum: мёртвых версий нет, вместо них redirect/unused
        expect(st3.filter((s) => s.state === 'dead')).toEqual([]);
        expect(st3.some((s) => s.state === 'redirect')).toBe(true);
        // сцена убрала свои таблицы
        const r = await db.query("select count(*)::int from pg_tables where tablename like 'vs_%'");
        expect(r.rows[0]![0]).toBe(0);
      } finally {
        await db.close();
      }
    }, 60_000);
  });
  ```
  (`runMvccScene` работает на чистой базе без датасета: `createNodeClient()`, `create extension pageinspect` внутри сцены. В компоненте её запускать через `sandbox.client()`; пользовательские данные урока она не трогает.)
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/pageinspect.test.ts`. FAIL: модулей нет.
- [ ] **Шаг 3. Код.**
  - `pageinspect.ts`: `readHeapPage` = `select lp, lp_flags, t_xmin, t_xmax, t_ctid from heap_page_items(get_raw_page('<table>', <page>))` (t_ctid парсить в строку; у redirect/unused пусто). `classifyVersions` по правилам выше. `pageinspect` уже зарегистрирован задачей 2, `create extension pageinspect` делает `readHeapPage` при первом вызове (idempotent).
  - `mvcc-scene.ts`: скрипт сцены (каждый шаг: выполнить операторы по одному через `client.exec`, прочитать страницу 0 таблицы сцены, снять `pg_current_xact_id()` и разметить факты):
    1. `create table vs_mvcc (id int primary key, val text)`, 3 вставки. Факты: вставивший xid в `committed` (он уже закоммичен на момент чтения). Кадр: 3 живые версии, `visible` = значения select.
    2. `update vs_mvcc set val = 'a2' where id = 1`. Факты: xid update в `committed`. Кадр: старая версия lp1 `dead` (xmax), новая lp4 `live`, ctid-перенаправление.
    3. `delete from vs_mvcc where id = 2`. Кадр: lp2 `dead`, без новой версии.
    4. `begin; update vs_mvcc set val = 'zz' where id = 3; rollback`. Факты: xid в `aborted`. Кадр: у lp3 xmax откатан (строка жива), вставленная lp5 `dead` (xmin откатан).
    5. `create table vs_parent (id int primary key, v text); insert into vs_parent values (1, 'x'); create table vs_child (pid int references vs_parent); insert into vs_child values (1);` Кадр на странице vs_parent: xmax стоит (проверка FK, FOR KEY SHARE), состояние `locked`, строка жива. Факты: xid вставки в `lockers`.
    6. `vacuum vs_mvcc`. Кадр: redirect/unused вместо мёртвых lp, живые на месте. Затем `drop table vs_mvcc, vs_parent, vs_child`.
  - `useStepper.ts`: индекс + next/prev + клавиши ←/→, автоплей off.
  - `MiniTable.tsx`: маленькая таблица (колонки/строки, состояние строки цветом: live зелёный, dead серый зачёркнутый, aborted серый с бейджем «откатана», locked с иконкой замка, redirect стрелка, unused пустая).
  - `MvccPage.tsx`: `<MvccPage>`: при монтировании грузит сцену (`useEffect` + `runMvccScene(useSandbox().sandbox?.client())`), рендерит шаги плеером, под каждым кадром подпись и «что видит SELECT» рядом с «что лежит на странице».
  - `components.ts` и MDX_TAGS: добавить `MvccPage`.
- [ ] **Шаг 4. Запуск.** Тесты PASS, `pnpm check`. Дом-тест не обязателен (рендер тонкий), но при появлении багов добавить `MvccPage.test.tsx` с моком `runMvccScene`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.4` → `✅ (<дата>)`.
  ```bash
  git add src/features/scenes/useStepper.ts src/features/scenes/MiniTable.tsx src/features/scenes/mvcc-scene.ts src/features/db/pageinspect.ts src/features/db/pageinspect.test.ts src/features/lessons/mdx/MvccPage.tsx src/features/lessons/mdx/components.ts tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(scenes): плеер шагов и MVCC-страница с классификацией версий

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 21. Движок сцен «две сессии» (P11.5)

PGlite однопоточный, живые конкурентные сессии не показать. Спека 4: срежиссированные сцены «две сессии»: две колонки-таймлайна, шаги по времени, видно, кто что видит и кто кого ждёт. Сценарий это TS-файл с ходом и ожиданиями; его честность проверяет CI на настоящем Postgres (задача 22). Компонент рендерит сценарий статически, база не нужна.

**Files:**
- Create: `src/features/sessions/types.ts`, `src/features/sessions/timeline.ts`, `src/features/sessions/timeline.test.ts`, `src/features/sessions/TwoSessions.tsx`, `src/features/sessions/TwoSessions.test.tsx`, `src/features/lessons/mdx/TwoSessionsBlock.tsx`
- Create: `content/scenarios/index.ts`, `content/scenarios/transactions.ts`, `content/scenarios/isolation.ts`, `content/scenarios/locks.ts`
- Modify: `src/features/lessons/mdx/components.ts`, `tests/content/lessons.test.ts` (MDX_TAGS: `<TwoSessions id>`)

**Interfaces:**
```ts
// types.ts
export interface ScenarioStep {
  session: 'a' | 'b';
  caption: string;          // что происходит на шаге
  sql: string;              // один оператор
  fire?: boolean;           // не ждать завершения: шаг ушёл и заблокировался
  expect?: { rows?: unknown[][] };   // ожидаемый результат SELECT (значения для сцены и для CI)
  expectError?: string;     // SQLSTATE ожидаемой ошибки
  note?: string;            // подпись на кадре: «ждёт блокировку A», «видит старую цену»
}
export interface Scenario {
  id: string;
  title: string;
  intro: string;
  setup: string;            // подготовка базы (один exec), пусто если не нужен
  cleanup?: string;         // приведение базы в порядок (один exec)
  steps: ScenarioStep[];
}

// timeline.ts
export interface TimelineFrame { session: 'a' | 'b'; index: number; state: 'done' | 'running' | 'pending'; text: string }
export function buildTimeline(sc: Scenario): TimelineFrame[];
// state вычисляется по позиции шага и по fire последующих шагов:
// шаг до первого fire-шага той же или другой сессии, который ещё «в полёте»: done;
// fire-шаг, чей ход ещё не дошёл: pending; активный fire-шаг: running.
export function visibleSnapshot(sc: Scenario, afterStep: number): string[]; // подписи note шагов 0..afterStep
```

- [ ] **Шаг 1. Падающий тест.** `src/features/sessions/timeline.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildTimeline, visibleSnapshot } from './timeline';

  const sc = {
    id: 'demo',
    title: '',
    intro: '',
    setup: '',
    steps: [
      { session: 'a', caption: 'A открывает транзакцию', sql: 'begin' },
      { session: 'a', caption: 'A обновляет строку', sql: 'update ...', fire: true },
      { session: 'b', caption: 'B читает строку', sql: 'select ...', expect: { rows: [['890']] }, note: 'B видит старую цену' },
    ],
  } as never;

  describe('timeline двух сессий', () => {
    it('шаги раскладываются по колонкам', () => {
      const f = buildTimeline(sc);
      expect(f.map((x) => x.session)).toEqual(['a', 'a', 'b']);
      expect(f[2]?.text).toContain('B');
    });
    it('подписи «кто что видит» собираются до шага', () => {
      expect(visibleSnapshot(sc, 2)).toEqual(['B видит старую цену']);
      expect(visibleSnapshot(sc, 1)).toEqual([]);
    });
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/sessions/timeline.test.ts`. FAIL: модулей нет.
- [ ] **Шаг 3. Код.**
  - `types.ts`, `timeline.ts` по интерфейсам выше.
  - `TwoSessions.tsx`: сетка из двух колонок «Сессия A» / «Сессия B», шаги-карточки (sql моно-шрифтом, статус: `expect` → «N строк» / конкретные значения, `expectError` → красный код SQLSTATE, `fire` → иконка ожидания), плеером из `useStepper` (шаг за шагом по общему порядку), под сеткой список «кто что видит» из `visibleSnapshot`. `aria-live` с caption.
  - `content/scenarios/*.ts`: сценарии (значения сверены с семантикой PG; истинность проверит задача 22):
    - `transactions.ts`: `tx-basic` (A: begin, update цены книги 1 на 1, fire не нужен: A не блокируется; B: select видит 890, note «B видит старую цену: транзакция A не закрыта»; A: commit; B: select видит 1; cleanup: вернуть 890), `tx-rollback` (то же с rollback, B оба раза видит 890), `savepoint` (одна сессия A: begin; savepoint s1; update бонуса покупателя 2 на -500 с expectError 23514; rollback to savepoint s1; select count(*) from customer expect rows [[6]], note «транзакция пережила ошибку»; commit).
    - `isolation.ts`: `non-repeatable-read` (B: begin; B: select цена 890; A: begin, update на 1, commit; B: select видит 1, note «Read Committed: B видит чужой коммит внутри своей транзакции»; B: commit; cleanup), `repeatable-read` (B: begin isolation level repeatable read; B: select 890; A: begin, update на 1, commit; B: select 890, note «Repeatable Read: снимок заморожен»; B: update на 2, expectError 40001, note «конфликт: строку поменяли после снимка»; B: rollback; cleanup).
    - `locks.ts`: `lock-for-update` (A: begin; A: select книги 1 for update, expect rows 1; B: begin; B: select книги 1 for update, fire: true, note «B ждёт: строка заблокирована A»; A: commit; ожидание B завершается, note «A отпустил блокировку, B получил строку»; B: commit), `deadlock` (A: begin, update книги 1; B: begin, update книги 2; A: update книги 2, fire, note «A ждёт B»; B: update книги 1, expectError 40P01, note «Postgres увидел цикл и убил транзакцию B»; A: шаг-подпись «A дождался и прошёл» через select, expect 1; A/B: rollback; cleanup. Если на настоящем PG жертвой оказывается A, поменять порядок UPDATE так, чтобы жертва была B, и обновить сценарий).
    - `index.ts`: реестр `SCENARIOS: Scenario[]` из трёх файлов.
  - `TwoSessionsBlock.tsx`: `<TwoSessions id>`: находит сценарий в `SCENARIOS`, рендерит `TwoSessions`. Неизвестный id: заметная ошибка рендера.
  - `components.ts`/MDX_TAGS: добавить `TwoSessions`.
- [ ] **Шаг 4. Запуск.** `timeline.test.ts` PASS. `TwoSessions.test.tsx` (dom): рендер с `id="tx-basic"` показывает две колонки, SQL первого шага, число шагов; неизвестный id даёт ошибку. `pnpm check`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.5` → `✅ (<дата>)`.
  ```bash
  git add src/features/sessions content/scenarios src/features/lessons/mdx/TwoSessionsBlock.tsx src/features/lessons/mdx/components.ts tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(sessions): срежиссированные сцены «две сессии»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 22. Проверка сценариев на Postgres в CI (P11.6)

Каждый сценарий из задачи 21 прогоняется на настоящем PostgreSQL 18 в Docker: две реальные сессии через npm `pg`, шаг за шагом, включая блокировки и коды ошибок (Review Focus 2). Локально без Docker тест пропускается: `describe.skipIf`.

**Files:**
- Create: `src/features/sessions/pg-runner.ts`, `src/features/sessions/scenarios.pg.test.ts`, `.github/workflows/sessions.yml`
- Modify: `package.json` (devDependencies)

**Interfaces:**
```ts
// pg-runner.ts
export interface StepReport { index: number; ok: boolean; problem?: string }
export async function runScenarioOnPostgres(sc: Scenario, dsn: string): Promise<StepReport[]>;
```

- [ ] **Шаг 1. Зависимости.** `pnpm add -D pg@8.23.1` и `pnpm add -D @types/pg`. Версия зафиксирована контрактами, раздел 1 (правка внесена задачей 1).
- [ ] **Шаг 2. Падающий тест.** `src/features/sessions/scenarios.pg.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { loadDatasetSql } from '@/features/db/datasets';
  import { SCENARIOS } from '@content/scenarios';
  import { runScenarioOnPostgres } from './pg-runner';

  const dsn = process.env.VS_PG_DSN;

  describe.skipIf(!dsn)('сценарии «две сессии» на настоящем Postgres', () => {
    for (const sc of SCENARIOS) {
      it(`сценарий ${sc.id}: ход совпадает с реальностью`, async () => {
        const reports = await runScenarioOnPostgres(sc, dsn!);
        expect(reports.filter((r) => !r.ok)).toEqual([]);
      }, 30_000);
    }
  });
  ```
  Run (без Docker): `pnpm vitest run --project node src/features/sessions/scenarios.pg.test.ts`. Expected: PASS со скипом. Run с `VS_PG_DSN`: FAIL, `runScenarioOnPostgres` не реализован.
- [ ] **Шаг 3. Код.** `pg-runner.ts` (ключевое):
  - Три клиента `pg.Client`: `a`, `b`, `ctrl` (управляющий). База под каждый сценарий своя: `create schema vs_<id>`; всем трём `set search_path to vs_<id>, public`; выполнить `loadDatasetSql('bookstore')` и `sc.setup` (каждый оператор по одному: разбить по `;` вне строк, или через `client.query` с массивом операторов из датасета: датасет это многооператорный скрипт, гнать по предложениям, как это делает тест контента).
  - Шаги по порядку. Обычный шаг: `await client.query(step.sql)` с таймаутом 5 c: если не вернулся, `ctrl.query('select pg_cancel_backend(pid)')` по pid из `select pg_backend_pid()`, снятому при старте сессии, и проблема «завис». fire-шаг: послать и не ждать, запомнить промис. Ожидание fire-промисов: сразу после каждого шага `commit`/`rollback` противоположной сессии и в конце сценария (иначе блокировка не проиграется: A держит блокировку, B повис, A обязан закрыть транзакцию). fire-промис, висящий после завершающего шага своей сессии, это проблема «не дождались».
  - Проверки: `expect.rows` сверяется с фактическими строками (значения в текстовом виде); `expectError` сверяется с `e.code`; неожиданная ошибка и неожиданный успех = проблема. Для `deadlock`: одна из сторон получает 40P01, вторая проходит, падение любой из них это проблема.
  - Финал: `sc.cleanup`, откатить открытые транзакции, `drop schema ... cascade`.
- [ ] **Шаг 4. Workflow.** `.github/workflows/sessions.yml`:
  ```yaml
  name: sessions
  on:
    push: { branches: [main] }
    pull_request:
  jobs:
    sessions:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:18
          env:
            POSTGRES_PASSWORD: postgres
          ports: ['5432:5432']
          options: >-
            --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
          with: { version: 10 }
        - uses: actions/setup-node@v4
          with: { node-version: 26, cache: pnpm }
        - run: pnpm install --frozen-lockfile
        - run: pnpm vitest run --project node src/features/sessions/scenarios.pg.test.ts
          env:
            VS_PG_DSN: postgres://postgres:postgres@localhost:5432/postgres
  ```
- [ ] **Шаг 5. Запуск.** Локально (если есть Docker): поднять `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18`, экспортировать `VS_PG_DSN`, прогнать тест. Ожидается PASS: все сценарии совпадают. Если сценарий расходится с реальностью: править сценарий под фактическое поведение Postgres (это его смысл), а не раннер. Ключевой подозреваемый: жертва deadlock (см. задачу 21).
  Затем `pnpm check`.
- [ ] **Шаг 6. Трекер и коммит.** `P11.6` → `✅ (<дата>)`.
  ```bash
  git add src/features/sessions/pg-runner.ts src/features/sessions/scenarios.pg.test.ts .github/workflows/sessions.yml package.json pnpm-lock.yaml docs/PROGRESS.md
  git commit -m "feat(sessions): CI-проверка сценариев на настоящем Postgres в Docker

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 23. Урок 11.1 «BEGIN, COMMIT, ROLLBACK, ACID» (L11.1)

Уроки главы 11 встраивают сцены «две сессии» из задачи 21 и используют многооператорные блоки. Правила: блок с `commit` это apply-блок (превью откатилось бы), блок с `rollback` в конце это run-блок; ожидание всегда по последнему оператору, значимый SELECT ставится последним. Явный `begin` внутри превью даёт WARNING «already in transaction», это видно в «Сообщениях» и упомянуто в тексте.

**Files:**
- Create: `content/lessons/11-transactions/01-transactions.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): цена книги 2 до 2400.00; после apply `begin; update ... = 7; commit; select` цена 7.00; после блока с rollback цена не меняется; rollback не удаляет строки: `count(*)` по orders остаётся 8.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L11\.1\*\*/- 🔄 ($(date +%F)) **L11\.1**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'transactions'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок transactions"`. Expected: FAIL, `нет урока transactions`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.8-12.10; https://www.postgresql.org/docs/current/tutorial-transactions.html и https://www.postgresql.org/docs/current/sql-begin.html.
  Тезисы урока:
  - Транзакция: несколько операторов «все или ничего». begin открывает, commit фиксирует, rollback отменяет всё.
  - Один оператор без begin это своя мини-транзакция (autocommit).
  - Демонстрация rollback: delete внутри begin...rollback, строки на месте.
  - ACID по буквам, каждое на примере из датасета: атомарность (перевод бонуса между покупателями), согласованность (CHECK не пустит минус), изолированность (сцены «две сессии»), надёжность (commit переживает перезапуск: у нас песочница в памяти, у Postgres WAL).
  - Сцены: `<TwoSessions id="tx-basic">` и `<TwoSessions id="tx-rollback">`.
  - Ловушка: превью в приложении само оборачивает запросы в транзакцию с откатом; поэтому в примерах с commit кнопка «Применить».
  Sql-блоки урока:
  ```sql run expect=rows:1
  select title, price from book where book_id = 2;
  ```
  ```sql apply expect=rows:1
  begin;
  update book set price = 7 where book_id = 2;
  commit;
  select title, price from book where book_id = 2;
  ```
  ```sql apply expect=rows:1
  begin;
  update book set price = 9 where book_id = 2;
  rollback;
  select title, price from book where book_id = 2;
  ```
  ```sql run expect=rows:8
  begin;
  delete from orders;
  rollback;
  select count(*) as n from orders;
  ```
  ```sql apply expectError=23514
  begin;
  update customer set bonus = bonus - 500 where customer_id = 2;
  commit;
  ```
  (ошибка внутри транзакции: COMMIT не спасает, всё откатывается; после блока песочница чиста сама, задача 3)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок transactions"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/transactions`: сцены «две сессии» проигрываются шагами.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L11\.1\*\*/- ✅ ($(date +%F)) **L11\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/11-transactions/01-transactions.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 11.1 «Транзакции»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 24. Урок 11.2 «SAVEPOINT» (L11.2)

**Files:**
- Create: `content/lessons/11-transactions/02-savepoint.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): книга 3 «Судьба человека» стоит 350.00; после блока «savepoint + откат + 999 + commit» цена 999.00; бонус покупателя 2 равен 0, попытка уменьшить на 500 даёт `23514`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L11\.2\*\*/- 🔄 ($(date +%F)) **L11\.2**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'savepoint'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок savepoint"`. Expected: FAIL, `нет урока savepoint`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.11; https://www.postgresql.org/docs/current/sql-savepoint.html.
  Тезисы урока:
  - savepoint это закладка внутри транзакции. `rollback to savepoint` откатывает к закладке, не закрывая транзакцию.
  - Главная сцена: пакетная загрузка, где одна плохая строка не должна рушить весь пакет.
  - Демонстрация: внутри одного begin сначала цена 1 (откатываем к savepoint), потом 999, commit: зафиксировалась только вторая.
  - Ошибка под savepoint: блок apply с `expectError=23514` падает на UPDATE, а продолжение показывает сцена «две сессии» (savepoint-сценарий из задачи 21): в интерактивной сессии после rollback to транзакция жива. Так и написать: песочница выполняет блок целиком и прерывается на первой ошибке, живое продолжение в сцене.
  - `release savepoint`, вложенные savepoint, имена.
  - Сцена: `<TwoSessions id="savepoint">`.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select title, price from book where book_id = 3;
  ```
  ```sql apply expect=rows:1
  begin;
  savepoint s1;
  update book set price = 1 where book_id = 3;
  rollback to savepoint s1;
  update book set price = 999 where book_id = 3;
  commit;
  select title, price from book where book_id = 3;
  ```
  ```sql run expect=rows:1
  select title, price from book where book_id = 3;
  ```
  ```sql apply expectError=23514
  begin;
  savepoint s1;
  update customer set bonus = bonus - 500 where customer_id = 2;
  rollback to savepoint s1;
  commit;
  ```
  ```sql noexec
  begin;
  savepoint s1;
  savepoint s2;
  rollback to savepoint s1;   -- откатит и s2
  release savepoint s1;
  commit;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок savepoint"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/savepoint`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L11\.2\*\*/- ✅ ($(date +%F)) **L11\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/11-transactions/02-savepoint.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 11.2 «SAVEPOINT»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 25. Урок 11.3 «MVCC» (L11.3)

**Files:**
- Create: `content/lessons/11-transactions/03-mvcc.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `select ctid, xmin, xmax from book where book_id = 1` даёт 1 строку; после `update` ctid книги 1 меняется (строка переезжает, `(0,1)` → новая позиция в конце страницы). Номера xid в тексте не называем (Global Constraints), только отношения: «xmin новой версии = xmax старой».
- Потребляет: `<MvccPage>` из задачи 20.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L11\.3\*\*/- 🔄 ($(date +%F)) **L11\.3**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'mvcc'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок mvcc"`. Expected: FAIL, `нет урока mvcc`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.12; https://www.postgresql.org/docs/current/mvcc.html и https://www.postgresql.org/docs/current/mvcc-intro.html.
  Тезисы урока:
  - MVCC: читатели не блокируют писателей. Каждый видит снимок на свой момент.
  - UPDATE это «новая версия строки + пометка старой». Системные колонки `xmin` (кто создал) и `xmax` (кто удалил/заменил) видны в SELECT.
  - Пример на book: ctid до/после update, «строка переехала».
  - Ненулевой xmax не значит «удалена»: проверка FK ставит в xmax блокировку. Показывает сцена.
  - Сцена `<MvccPage>`: шаги «жизнь страницы»: вставки, update (старая версия мертвеет, новая живёт), delete, откатанная транзакция, блокировка FK, VACUUM выметает мёртвые версии и ставит перенаправления.
  - Мёртвые версии копятся до VACUUM. Автовакуум в песочнице не работает (PGlite), поэтому «мусор» видно руками: наглядно.
  - Аналогия: вики-страница с историей правок: читатель держит свою ревизию, редактор правит новую, старая висит, пока уборщик не придёт.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select ctid, xmin, xmax from book where book_id = 1;
  ```
  ```sql apply expect=rows:1
  update book set price = price + 10 where book_id = 1 returning title, price;
  ```
  ```sql run expect=rows:1
  select ctid, xmin, xmax from book where book_id = 1;
  ```
  (в тексте: сравни две выдачи, ctid сменился, xmin вырос; это и есть новая версия)
  ```sql apply expect=rows:0
  vacuum book;
  ```
  (vacuum: отдельный apply-блок из одного оператора, 25001 в транзакции)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок mvcc"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/mvcc`: пройти все шаги `<MvccPage>`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L11\.3\*\*/- ✅ ($(date +%F)) **L11\.3**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/11-transactions/03-mvcc.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 11.3 «MVCC»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 26. Урок 11.4 «Уровни изоляции» (L11.4)

**Files:**
- Create: `content/lessons/11-transactions/04-isolation.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `show transaction_isolation` → `read committed`; `begin isolation level repeatable read; select count(*) from book; commit` → 11.
- Потребляет: сцены `<TwoSessions id="non-repeatable-read">` и `<TwoSessions id="repeatable-read">`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L11\.4\*\*/- 🔄 ($(date +%F)) **L11\.4**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'isolation'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок isolation"`. Expected: FAIL, `нет урока isolation`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.13-12.16; https://www.postgresql.org/docs/current/transaction-iso.html.
  Тезисы урока:
  - Уровень изоляции отвечает на вопрос: что транзакция видит из чужих коммитов.
  - Read Committed (умолчание): каждый оператор видит свежий снимок. Аномалия: неповторяющееся чтение (сцена).
  - Repeatable Read: снимок на весь begin. Чужие коммиты не видны. Конфликт записи → `40001` (сцена).
  - Serializable: Repeatable Read плюс проверки «как если бы выполнялось по очереди»; ошибки сериализации обрабатывать повтором. В PGlite показывается текстом, механика та же.
  - Правило продакшена: читал данные и хочешь на них писать: Repeatable Read/Serializable и готовность к 40001.
  Sql-блоки урока:
  ```sql run expect=rows:1
  show transaction_isolation;
  ```
  ```sql run expect=rows:1
  begin isolation level repeatable read;
  select count(*) as n from book;
  commit;
  ```
  ```sql run expect=rows:1
  begin transaction isolation level read committed, read only;
  select count(*) as n from book;
  commit;
  ```
  ```sql noexec
  begin isolation level serializable;
  -- ... работа ...
  commit;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок isolation"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/isolation`: обе сцены «две сессии» пройти по шагам.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L11\.4\*\*/- ✅ ($(date +%F)) **L11\.4**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/11-transactions/04-isolation.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 11.4 «Уровни изоляции»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 27. Урок 11.5 «Блокировки, FOR UPDATE, deadlock» (L11.5)

**Files:**
- Create: `content/lessons/11-transactions/05-locks.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `select ... for update` книги 1 возвращает 1 строку; deadlock даёт `40P01`; уронить SELECT блокировкой нельзя (MVCC: читатели не ждут писателей).
- Потребляет: сцены `<TwoSessions id="lock-for-update">` и `<TwoSessions id="deadlock">`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L11\.5\*\*/- 🔄 ($(date +%F)) **L11\.5**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'locks'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок locks"`. Expected: FAIL, `нет урока locks`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.17; https://www.postgresql.org/docs/current/explicit-locking.html и https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE.
  Тезисы урока:
  - Блокировки строк: `for update` (писательская), `for share` (читательская). Держатся до конца транзакции.
  - Кто кого ждёт: две сцены.
  - Читатель без for update никого не ждёт: MVCC.
  - Deadlock: цикл ожидания. Postgres замечает сам (deadlock_timeout ~1 с) и убивает одну транзакцию `40P01`. Лечение: единый порядок доступа к строкам (в сцене A и B хватают книги в разном порядке).
  - `lock_timeout`, `nowait`, `skip locked` (очереди задач): noexec-блоки.
  - Правило: блокируй только то, что будешь менять, и на минимальное время.
  Sql-блоки урока:
  ```sql apply expect=rows:1
  begin;
  select book_id, title from book where book_id = 1 for update;
  commit;
  ```
  ```sql run expect=rows:1
  select book_id, title from book where book_id = 1 for update nowait;
  ```
  (nowait: в превью чужих блокировок нет, строка сразу отдаётся)
  ```sql noexec
  select book_id from orders where status = 'new' order by order_id
    for update skip locked limit 10;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок locks"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/locks`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L11\.5\*\*/- ✅ ($(date +%F)) **L11\.5**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/11-transactions/05-locks.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 11.5 «Блокировки и deadlock»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 28. Вкладка «План»: EXPLAIN и связь узла со стадией (P11.9)

Спека 3.8: вкладка «План» в панели результата, дерево узлов, толщина рёбер по числу строк, наведение подсвечивает шаг на доске. Счётчик «прочитано строк» (Review Focus 4) считается из данных плана: `Actual Rows + Rows Removed by Filter`.

**Files:**
- Create: `src/features/tracer/explain.ts`, `src/features/tracer/explain.test.ts`
- Modify: `src/features/tracer/trace.ts` (заполнение `Trace.plan` для SELECT), `src/features/results/ResultsPanel.tsx`, `src/features/results/PlanTree.tsx`, `src/stores/scene.ts` (hoveredStage, контракт задача 1), `src/features/timeline/Timeline.tsx` (подсветка чипа при hoveredStage)

**Interfaces:**
```ts
// explain.ts
export interface PlanNode {
  nodeType: string;            // 'Seq Scan', 'Index Scan', 'Sort', 'Limit', ...
  relation?: string;           // 'orders'
  indexName?: string;
  filter?: string;             // Filter
  indexCond?: string;
  planRows?: number;           // Plan Rows
  actualRows?: number;         // Actual Rows
  rowsRemoved?: number;       // Rows Removed by Filter
  loops?: number;
  sharedHitBlocks?: number;
  actualTotalTime?: number;
  totalCost?: number;
  children: PlanNode[];
}
export async function explainPlan(db: DbClient, sql: string): Promise<PlanNode | null>;
export function rowsRead(node: PlanNode): number | null;
export function linkPlanToStages(plan: PlanNode, stages: Stage[]): Array<{ node: PlanNode; stageIndex: number | null }>;
```

- [ ] **Шаг 1. Падающий тест.** `src/features/tracer/explain.test.ts`:
  ```ts
  import { beforeAll, describe, expect, it } from 'vitest';
  import { initParser, parseSql } from '@/features/sql/parser';
  import { withDataset, inPreview } from '../../../tests/helpers/db';
  import { explainPlan, linkPlanToStages, rowsRead } from './explain';
  import { traceStatement } from './trace';
  import { introspect } from '@/features/db/introspect';

  describe('план EXPLAIN', () => {
    beforeAll(() => initParser());

    it('дерево плана читается, узлы связываются со стадиями, счётчик честный', async () => {
      await withDataset('big_bookstore', async (db) => {
        const sql = 'select * from orders where customer_id = 42 order by order_id limit 5';
        const plan = await explainPlan(db, sql);
        expect(plan).not.toBeNull();
        expect(plan!.nodeType).toBe('Limit');
        const sort = plan!.children[0]!;
        expect(sort.nodeType).toBe('Sort');
        const seq = sort.children[0]!;
        expect(seq.nodeType).toBe('Seq Scan');
        // счётчик прочитанных строк: найдено + отфильтровано
        expect(rowsRead(seq)).toBe(100000);   // 5 + 99995
        // связка со стадиями трассы
        const parsed = parseSql(sql);
        const stmt = parsed.statements[0]!;
        const schema = await introspect(db);
        const trace = await inPreview(db, () => traceStatement(stmt, db, { schema }));
        const links = linkPlanToStages(plan!, trace.stages);
        const byType = new Map(links.map((l) => [l.node.nodeType, l.stageIndex]));
        expect(byType.get('Limit')).not.toBeNull();
        expect(trace.stages[byType.get('Limit')!]!.kind).toBe('limit');
        expect(trace.stages[byType.get('Sort')!]!.kind).toBe('sort');
        expect(trace.stages[byType.get('Seq Scan')!]!.kind).toBe('scan');
      });
    }, 120_000);

    it('план кладётся в Trace', async () => {
      await withDataset('big_bookstore', async (db) => {
        const parsed = parseSql('select count(*) from orders');
        const stmt = parsed.statements[0]!;
        const schema = await introspect(db);
        const trace = await inPreview(db, () => traceStatement(stmt, db, { schema }));
        expect(trace.plan?.nodeType).toBe('Aggregate');
      });
    }, 120_000);
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/tracer/explain.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.**
  - `explainPlan`: `select ...` → `explain (analyze, format json) <sql>` (rowMode array: первая колонка это JSON-строка, распарсить и взять `[0]['Plan']`; рекурсивно `Plans` → `children`). Вызывается только внутри preview (сам оператор выполняется и откатывается). Для не-SELECT: null.
  - `rowsRead`: `actualRows * loops + rowsRemoved` (loops > 1 у внутренних узлов; для Seq Scan/Bitmap Heap Scan это «сколько строк просмотрено»).
  - `linkPlanToStages`: узел → стадия по правилам: `Seq Scan`/`Index Scan`/`Bitmap Heap Scan`/`Bitmap Index Scan` → `scan`; `Filter` в узле скана → ближайшая `filter`; `Sort` → `sort`; `Limit` → `limit`; `Aggregate`/`Group` → `group`; `Hash Join`/`Nested Loop`/`Merge Join` → `join`; `Result`/`Unique`/прочее → `null`. Узел скана с `relation` связывается со `scan`-стадией того же `tableId`.
  - `trace.ts`: в конце трассировки SELECT, при отсутствии ошибки, позвать `explainPlan` и записать `Trace.plan`.
  - `PlanTree.tsx`: дерево (вложенные списки), толщина левой границы узла ∝ `actualRows`, подпись `«Seq Scan по orders: прочитано 100000 строк, найдено 5»`, `onMouseEnter` → `useSceneStore.setHoveredStage(stageIndex)`, на выходе `setHoveredStage(null)`.
  - `ResultsPanel.tsx`: вкладка «План» активна, когда `trace.plan` не пуст (после главы 12 всегда для SELECT; для MVP-уроков без плана вкладки нет, чтобы не менять поведение Ф4-Ф10).
  - `Timeline.tsx`: чип стадии с `hoveredStage === i` подсвечен.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`. Убедиться, что MVP-уроки не изменились: `pnpm test:content`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.9` → `✅ (<дата>)`.
  ```bash
  git add src/features/tracer/explain.ts src/features/tracer/explain.test.ts src/features/tracer/trace.ts src/features/results/ResultsPanel.tsx src/features/results/PlanTree.tsx src/stores/scene.ts src/features/timeline/Timeline.tsx docs/PROGRESS.md
  git commit -m "feat(results): вкладка «План» с деревом EXPLAIN и связью со стадиями

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 29. B-дерево, Seq vs Index Scan, счётчик прочитанных строк (P11.8)

Спека 4: B-дерево рисуется деревом, при Seq Scan сканер проходит всю таблицу, при Index Scan путь спускается по дереву и прыгает к строкам, счётчик «прочитано строк» рядом. Дерево и путь отдаёт настоящий Postgres через pageinspect (контриб задачи 2). Проверенные факты (PGlite 18.3, 2026-10-08, big_bookstore): `orders_pkey` занимает 276 страниц, корень страница 3 (уровень 1, 274 элемента, у первого элемента пустой `data`, это «минус бесконечность»), листья со страницы 2 и 4 по 276, в листе ~366 ключей; ключ 5000 лежит в листе страница 15, смещение 243, указывает в кучу `(36,104)`; `data` это ключ little-endian (`88 13 00 00...` = 5000); куча `orders` 736 страниц; Seq Scan по `customer_id = 42` читает 100000 строк (99995 отфильтровано), Index Scan по `order_id between 5000 and 5009` трогает 6 страниц.

**Files:**
- Create: `src/features/db/btree.ts`, `src/features/db/btree.test.ts`, `src/features/scenes/btree-layout.ts`, `src/features/scenes/btree-layout.test.ts`, `src/features/lessons/mdx/BTreeScene.tsx`
- Modify: `src/features/lessons/mdx/components.ts`, `tests/content/lessons.test.ts` (MDX_TAGS)

**Interfaces:**
```ts
// btree.ts
export interface BTreeItem { offset: number; key: number | null; ctid: string }   // key null = «минус бесконечность»
export interface BTreeIndex { rootPage: number; level: number; pages: number; rootItems: BTreeItem[] }
export async function readBTreeIndex(db: DbClient, indexId: string): Promise<BTreeIndex | null>;
export function decodeKey(data: string): number | null;   // '88 13 00 00 00 00 00 00' → 5000
export function searchPath(idx: BTreeIndex, key: number): { leafPage: number; ctid: string } | null;
// bt_page_items по корню: item.ctid → '(leafPage, itemOffset)'; leafPage с наибольшим ключом < key;
// ключи корня сравниваются через decodeKey; ctid из нужного листа взять нельзя (273 листа) -
// поэтому searchPath возвращает leafPage, а ctid сверяется снаружи запросом к куче

// btree-layout.ts
export interface BTreeLayout {
  root: { x: number; y: number; items: BTreeItem[] };
  leaves: Array<{ page: number; x: number; y: number; selected: boolean }>;
}
export function buildBTreeLayout(idx: BTreeIndex, selectedLeaf: number | null): BTreeLayout;
```

- [ ] **Шаг 1. Падающий тест.** `src/features/db/btree.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { withDataset } from '../../../tests/helpers/db';
  import { decodeKey, readBTreeIndex, searchPath } from './btree';

  describe('btree по pageinspect', () => {
    it('структура и поиск по orders_pkey', async () => {
      await withDataset('big_bookstore', async (db) => {
        await db.exec('create extension pageinspect');
        const idx = await readBTreeIndex(db, 'orders_pkey');
        expect(idx).toMatchObject({ rootPage: 3, level: 1, pages: 276 });
        expect(idx!.rootItems.length).toBe(274);
        expect(idx!.rootItems[0]!.key).toBeNull();          // минус бесконечность
        expect(decodeKey('88 13 00 00 00 00 00 00')).toBe(5000);
        expect(searchPath(idx!, 5000)?.leafPage).toBe(15);
      });
    }, 120_000);
  });
  ```
  `btree-layout.test.ts` (чистый): `buildBTreeLayout` с фейковым индексом (4 листа) кладёт корень сверху, листья в ряд, `selected: true` только у выбранного.
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/db/btree.test.ts src/features/scenes/btree-layout.test.ts`. FAIL: модулей нет.
- [ ] **Шаг 3. Код.**
  - `btree.ts`: `readBTreeIndex` = `bt_metap(indexId)` (root, level) + `bt_page_items(indexId, root)` + `relpages` из `pg_class`; `decodeKey` парсит hex-байты `data` (int8/int4, little-endian; пустая строка → null); `searchPath` спускается по корню: `rootItems` отсортированы по ключу, выбрать последний элемент с ключом ≤ искомого, его ctid `(page, off)` даёт лист.
  - `BTreeScene.tsx`: `<BTreeScene table index column value>`: всё чтение внутри `sandbox.preview` (read-only): `readBTreeIndex`, `pg_class.relpages` кучи, `select ctid from <table> where <column> = <value>`, и два плана из `explain (analyze, format json)` (seq-запрос `where <column> = value` без индекса по колонке... аккуратно: для пары table/column индекса может не быть; сцене передают index, и seq-кадр показывает план запроса по `order_id`-фильтру без использования индекса: запрос `where order_id = 5000` на big_bookstore с `orders_pkey` как раз даёт Index Scan; для seq-кадра взять `select * from orders where customer_id = 42`, где индекса нет). Кадры:
    1. «Таблица»: полоса страниц кучи (736 квадратиков), счётчик строк 100000.
    2. «Seq Scan»: сканер пробегает полосу, счётчик «прочитано 100000 строк, найдено 5» (значения из плана).
    3. «Дерево»: корень сверху, листья полосой, у корня подпись «274 разделителя, 2 уровня».
    4. «Index Scan»: путь value → корень (бинарный поиск по разделителям) → лист 15 → прыжок в кучу `(36,104)`, счётчик «прочитано ~6 страниц, найдено 1».
  - Использует `useStepper`/`MiniTable` из задачи 20.
  - `components.ts`/MDX_TAGS: добавить `BTreeScene`.
- [ ] **Шаг 4. Запуск.** Тесты PASS, `pnpm check`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.8` → `✅ (<дата>)`.
  ```bash
  git add src/features/db/btree.ts src/features/db/btree.test.ts src/features/scenes/btree-layout.ts src/features/scenes/btree-layout.test.ts src/features/lessons/mdx/BTreeScene.tsx src/features/lessons/mdx/components.ts tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(scenes): B-дерево из pageinspect и счётчик прочитанных строк

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Уроки главы 12 (задачи 30-36)

Общие правила (помимо правил уроков главы 5):

- Датасет `big_bookstore`, доска показывает таблицы сжато (задача 5): `book.tables` указывать явно, чтобы не грузить 4 таблицы.
- Тесты контента проверяют у `explain`-блоков только число строк результата (обычно 1): время выполнения и буферы плавают. В тексте числа времени писать как «порядок величины», со словами «на этой машине».
- Сцена `<BTreeScene>` из задачи 29. Вкладка «План» из задачи 28.
- `create index` и `analyze` идут apply-блоками: ANALYZE, как и VACUUM, меняет статистику и выполняется в уроках одиночным оператором вне транзакционных блоков.

---

## Задача 30. Урок 12.1 «B-tree, Seq Scan vs Index Scan» (L12.1)

**Files:**
- Create: `content/lessons/12-indexes/01-btree-seq-vs-index.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `orders` 100000 строк, 736 страниц кучи; `orders_pkey` 276 страниц, корень страница 3, 274 разделителя, 2 уровня; ключ 5000: лист страница 15, куча `(36,104)`; Seq Scan `customer_id = 42`: найдено 5, отфильтровано 99995, 736 страниц, единицы миллисекунд; Index Scan `order_id between 5000 and 5009`: 10 строк, 6 страниц; после `create index on orders (customer_id)` запрос по 42 идёт через Bitmap Heap Scan.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.1\*\*/- 🔄 ($(date +%F)) **L12\.1**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'btree-seq-vs-index'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок btree-seq-vs-index"`. Expected: FAIL, `нет урока btree-seq-vs-index`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.18; https://www.postgresql.org/docs/current/indexes-types.html (B-tree) и https://www.postgresql.org/docs/current/indices-types.html#INDICES-TYPES.
  Тезисы урока:
  - Seq Scan: прочитать всю таблицу. Честно, когда строк много или таблица мала.
  - B-tree: отсортированное дерево по ключу. Поиск = спуск: 2 уровня на 100000 строк.
  - Сцена `<BTreeScene table="orders" index="orders_pkey" column="order_id" value="5000">`: кадры Seq/Index со счётчиками.
  - Index Scan прыгает по ctid прямо к строкам.
  - «Когда индекс не нужен»: фильтр по неиндексированной колонке, большая доля строк.
  - `ctid` как «физический адрес» строки (уже знаком по MVCC).
  Sql-блоки урока:
  ```sql run expect=rows:1
  select ctid, order_id from orders where order_id = 5000;
  ```
  ```sql run expect=rows:5
  select order_id from orders where customer_id = 42 order by order_id;
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select * from orders where customer_id = 42;
  ```
  (текст: вкладка «План», Rows Removed by Filter 99995, прочитано 736 страниц)
  ```sql run expect=rows:1
  explain (analyze, format json) select * from orders where order_id between 5000 and 5009;
  ```
  (текст: Index Scan, 6 страниц, единицы строк)
  ```sql apply expect=rows:0
  create index on orders (customer_id);
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select * from orders where customer_id = 42;
  ```
  (текст: план сменился на Bitmap Heap Scan: строк мало, но не одна: битовая карта страниц)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок btree-seq-vs-index"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/btree-seq-vs-index`: сжатые таблицы на доске, сцена B-дерева по шагам.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.1\*\*/- ✅ ($(date +%F)) **L12\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/01-btree-seq-vs-index.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.1 «B-tree, Seq Scan vs Index Scan»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 31. Урок 12.2 «EXPLAIN, EXPLAIN ANALYZE» (L12.2)

**Files:**
- Create: `content/lessons/12-indexes/02-explain.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `Plan Rows` для `customer_id = 42` изначально 5 (статистика свежая, `analyze` в датасете); `Actual Rows` 5; `Rows Removed by Filter` 99995; время Seq Scan единицы миллисекунд (плавает, в тексте не фиксировать); `explain (analyze, format json) update orders set status = status where order_id = 1` выполняется и откатывается превью.
- Потребляет: вкладку «План» (задача 28), `hoveredStage`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.2\*\*/- 🔄 ($(date +%F)) **L12\.2**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'explain'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок explain"`. Expected: FAIL, `нет урока explain`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.19; https://www.postgresql.org/docs/current/using-explain.html.
  Тезисы урока:
  - Дерево плана читается снизу вверх / изнутри наружу. Каждый узел: что делает, сколько строк вернул, сколько стоит.
  - `cost`: стартовый..полный (условные единицы), `rows`: оценка. ANALYZE добавляет фактические `Actual Rows` и время.
  - Оценка против факта: большое расхождение = устаревшая статистика (мост к 12.5).
  - `Rows Removed by Filter`: сколько строк просмотрено зря. Главный симптом «нужен индекс».
  - Буферы: `explain (analyze, buffers)`: hit против read.
  - Вкладка «План»: наведение на узел подсвечивает стадию на доске (мост трассы и плана).
  - ANALYZE выполняет запрос по-настоящему: для UPDATE в превью безопасно, «Применить» не нажимать.
  Sql-блоки урока:
  ```sql run expect=rows:1
  explain (analyze, format json) select * from orders where customer_id = 42;
  ```
  ```sql run expect=rows:1
  explain (analyze, buffers, format json) select * from orders where order_id between 5000 and 5009;
  ```
  ```sql run expect=rows:1
  explain (format json) select * from orders where customer_id = 42;
  ```
  (без analyze: только оценки, узел тот же)
  ```sql run trace=final-only expect=rows:1
  explain (analyze, format json) update orders set status = status where order_id = 1;
  ```
  (final-only: EXPLAIN не трассируется; над блоком комментарий `{/* final-only: EXPLAIN не проходит через трассировщик */}`)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок explain"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/explain`: связка «узел плана ↔ подсветка стадии».
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.2\*\*/- ✅ ($(date +%F)) **L12\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/02-explain.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.2 «EXPLAIN и EXPLAIN ANALYZE»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 32. Урок 12.3 «Составные индексы» (L12.3)

**Files:**
- Create: `content/lessons/12-indexes/03-composite-indexes.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `status = 'new' and created_at >= '2023-06-01 00:00+03'` → 1696 строк; `created_at >= '2023-06-01 00:00+03'` без статуса → 56513 строк; после `create index on orders (status, created_at)` первый запрос идёт по индексу, второй по BRIN/seq (индекс `(status, created_at)` второй колонке без первой не помогает).

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.3\*\*/- 🔄 ($(date +%F)) **L12\.3**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'composite-indexes'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок composite-indexes"`. Expected: FAIL, `нет урока composite-indexes`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.20; https://www.postgresql.org/docs/current/indexes-multicolumn.html.
  Тезисы урока:
  - Составной индекс это «телефонная книга»: фамилия, потом имя. `(status, created_at)`: сначала статус, внутри него время.
  - Правило левого префикса: фильтр по второй колонке без первой индекс почти не использует. Числа-якоря.
  - Равенство сначала, диапазон потом: `where a = ? and b > ?` любит `(a, b)`, наоборот хуже.
  - Два индекса vs один составной: сравнить, когда каждый фильтруется сам по себе.
  - Индекс для сортировки: `order by status, created_at` может обойтись без Sort.
  Sql-блоки урока:
  ```sql run expect=rows:1696
  select count(*) as n from orders where status = 'new' and created_at >= '2023-06-01 00:00+03';
  ```
  ```sql run expect=rows:56513
  select count(*) as n from orders where created_at >= '2023-06-01 00:00+03';
  ```
  ```sql apply expect=rows:0
  create index on orders (status, created_at);
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select count(*) from orders where status = 'new' and created_at >= '2023-06-01 00:00+03';
  ```
  (текст: Bitmap Index Scan по orders_status_created_at_idx)
  ```sql run expect=rows:1
  explain (analyze, format json) select count(*) from orders where created_at >= '2023-06-01 00:00+03';
  ```
  (текст: левого префикса нет, индекс составной не используется)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок composite-indexes"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/composite-indexes`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.3\*\*/- ✅ ($(date +%F)) **L12\.3**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/03-composite-indexes.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.3 «Составные индексы»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 33. Урок 12.4 «Уникальный, частичный, по выражению, покрывающий» (L12.4)

**Files:**
- Create: `content/lessons/12-indexes/04-index-variants.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): уникальный частичный индекс `(customer_id) where status = 'new'` падает `23505` (заказов new несколько на покупателя); `lower(email) = 'user42@example.com'` → 1 покупатель; email в данных в смешанном регистре (`User42@Example.com`); после `create index on orders (customer_id) include (status)` запрос `select status ... where customer_id = 42` использует индекс без визита в кучу (Heap Fetches 5: данные не все-visible, объяснить текстом).

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.4\*\*/- 🔄 ($(date +%F)) **L12\.4**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'index-variants'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок index-variants"`. Expected: FAIL, `нет урока index-variants`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.21, 12.25-12.27; https://www.postgresql.org/docs/current/indexes-unique.html, https://www.postgresql.org/docs/current/indexes-partial.html, https://www.postgresql.org/docs/current/indexes-expressional.html и https://www.postgresql.org/docs/current/indexes-index-only-scans.html.
  Тезисы урока:
  - Уникальный индекс это ограничение и индекс сразу. Частичный: уникальность только на срезе («не больше одного активного»).
  - В нашем датасете частичный уникальный индекс не создаётся: заказов new по несколько на покупателя, покажем ошибку 23505 и разберём, что она значит и какой датасет позволил бы такой индекс.
  - По выражению: поиск без регистра в email. Индекс по `lower(email)`, запрос обязан писать `lower(email) = ...` тем же выражением.
  - Покрывающий: `include` кладёт в индекс «паспортные данные», Index Only Scan не ходит в кучу (если страницы все-visible; Heap Fetches показывает, сколько раз всё-таки сходил).
  Sql-блоки урока:
  ```sql run expectError=23505
  create unique index on orders (customer_id) where status = 'new';
  ```
  (run-блок: превью откатит создание; в тексте: «почему упало и какой датасет нужен»)
  ```sql run expect=rows:1
  select customer_id, email from customer where lower(email) = 'user42@example.com';
  ```
  ```sql apply expect=rows:0
  create index on customer (lower(email));
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select customer_id from customer where lower(email) = 'user42@example.com';
  ```
  (текст: Bitmap Index Scan по индексу выражения)
  ```sql apply expect=rows:0
  create index on orders (customer_id) include (status);
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select status from orders where customer_id = 42;
  ```
  (текст: Plan Width 4 и Heap Fetches)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок index-variants"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/index-variants`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.4\*\*/- ✅ ($(date +%F)) **L12\.4**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/04-index-variants.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.4 «Уникальный, частичный, по выражению, покрывающий»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 34. Урок 12.5 «Селективность, статистика, ANALYZE» (L12.5)

**Files:**
- Create: `content/lessons/12-indexes/05-selectivity.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `pg_stats` по `orders.customer_id`: `n_distinct` около -0.2 (отрицательное = доля уникальных), `correlation` около 0; по `created_at`: `correlation` 1 (физический порядок совпадает, база для BRIN); `status`: most_common_vals `{paid,shipped,cancelled,new}`, частоты 0.67/0.25/0.05/0.03; `count(*) where status = 'paid'` → 67000.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.5\*\*/- 🔄 ($(date +%F)) **L12\.5**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'selectivity'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок selectivity"`. Expected: FAIL, `нет урока selectivity`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.23, 12.30; https://www.postgresql.org/docs/current/planner-stats.html.
  Тезисы урока:
  - Планировщик не смотрит данные, он смотрит статистику (гистограммы, частые значения, корреляция) из `pg_stats`.
  - Селективность условия: какая доля строк останется. 5 из 100000: индекс; 67000 из 100000: Seq Scan честнее.
  - `correlation` 1 у `created_at`: данные лежат по порядку, BRIN (урок 12.6) дёшев.
  - Статистика устаревает после больших вставок: `analyze` пересобирает. Автовакуум следит в проде.
  - Почему оценка бывает врёт: нет гистограммы по выражению, редкие значения.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select n_distinct, correlation from pg_stats where tablename = 'orders' and attname = 'customer_id';
  ```
  ```sql run expect=rows:1
  select correlation from pg_stats where tablename = 'orders' and attname = 'created_at';
  ```
  ```sql run expect=rows:1
  select most_common_vals, most_common_freqs from pg_stats where tablename = 'orders' and attname = 'status';
  ```
  ```sql run expect=rows:67000
  select count(*) as n from orders where status = 'paid';
  ```
  ```sql run expect=rows:1
  explain (format json) select * from orders where status = 'paid';
  ```
  (текст: планировщик знает про 67%, выбирает Seq Scan)
  ```sql apply expect=rows:0
  analyze orders;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок selectivity"`. Expected: PASS (числа n_distinct/correlation плавают в 4-м знаке: ожидание в тесте только на число строк, значения в тексте с «около»).
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/selectivity`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.5\*\*/- ✅ ($(date +%F)) **L12\.5**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/05-selectivity.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.5 «Селективность и статистика»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 35. Урок 12.6 «GIN, GiST, BRIN, Hash» (L12.6)

**Files:**
- Create: `content/lessons/12-indexes/06-index-types.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `title ilike '%о Python%'` → 16667 книг; `title ilike '%Книга 8 о Python%'` → 1; после GIN-индекса по `gin_trgm_ops` запрос по единственной книге идёт через Bitmap Index Scan; BRIN по `created_at` на сутки 2023-06-01: найдено 288 строк, recheck «пропустил» 17120; `pg_trgm` ставится `create extension` (контриб задачи 2); Hash-индекс по email создаётся.
- Внимание: `create extension pg_trgm` и `create index` держать отдельными apply-блоками: exec с несколькими операторами технически допустим, но по одному оператору на блок читается лучше, и создание расширения видно как отдельный шаг.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.6\*\*/- 🔄 ($(date +%F)) **L12\.6**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'index-types'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок index-types"`. Expected: FAIL, `нет урока index-types`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.28; https://www.postgresql.org/docs/current/indexes-types.html и https://www.postgresql.org/docs/current/gin.html, https://www.postgresql.org/docs/current/brin.html.
  Тезисы урока:
  - B-tree умеет сравнения (равенство, диапазоны, сортировка). Остальное не его работа.
  - GIN: «инвертированный список», для составных значений: jsonb, массивы, полнотекстовый поиск, триграммы (расширение pg_trgm) для ilike.
  - GiST: геометрия, диапазоны, поиск по соседству (kNN); обзорно.
  - BRIN: крошечный индекс для огромных таблиц с естественным порядком (created_at): хранит min/max по блокам. Корреляция 1 из 12.5.
  - Hash: только равенство; в проде почти не выбирают, показать для полноты.
  - Размеры: GIN тяжёлый на запись, BRIN почти бесплатный.
  Sql-блоки урока:
  ```sql run expect=rows:16667
  select count(*) as n from book where title ilike '%о Python%';
  ```
  ```sql apply expect=rows:0
  create extension pg_trgm;
  ```
  ```sql apply expect=rows:0
  create index on book using gin (title gin_trgm_ops);
  ```
  ```sql run expect=rows:1
  select count(*) as n from book where title ilike '%Книга 8 о Python%';
  ```
  ```sql run expect=rows:1
  explain (analyze, format json) select count(*) from book where title ilike '%Книга 8 о Python%';
  ```
  (текст: Bitmap Index Scan по book_title_idx)
  ```sql apply expect=rows:0
  create index on orders using brin (created_at);
  ```
  ```sql run expect=rows:288
  select count(*) as n from orders where created_at >= '2023-06-01 00:00+03' and created_at < '2023-06-02 00:00+03';
  ```
  ```sql apply expect=rows:0
  create index on customer using hash (email);
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок index-types"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/index-types`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.6\*\*/- ✅ ($(date +%F)) **L12\.6**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/06-index-types.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.6 «GIN, GiST, BRIN, Hash»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 36. Урок 12.7 «Ненужные индексы, CONCURRENTLY» (L12.7)

**Files:**
- Create: `content/lessons/12-indexes/07-index-maintenance.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `create index concurrently` в транзакции → `25001`; одиночным apply-блоком выполняется; `pg_stat_user_indexes.idx_scan` в PGlite всегда 0 (статистика активности не собирается, Global Constraints); `pg_indexes` по `orders` показывает все созданные уроком индексы.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L12\.7\*\*/- 🔄 ($(date +%F)) **L12\.7**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'index-maintenance'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок index-maintenance"`. Expected: FAIL, `нет урока index-maintenance`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.22, 12.24; https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY и PG wiki «Don't Do This» про индексы.
  Тезисы урока:
  - Цена индекса: запись замедляется, диск занят. Ненужный индекс это чистый налог.
  - Как ищут ненужные: `pg_stat_user_indexes.idx_scan` около нуля при живом трафике. В песочнице счётчик всегда 0 (PGlite не собирает статистику активности): честная пометка в тексте, пример из продакшена.
  - `create index concurrently`: не блокирует записи, дольше и «неудачный» индекс остаётся INVALID. В транзакции нельзя (25001): показать.
  - Reindex, `drop index` (точечно, не cascade).
  Sql-блоки урока:
  ```sql run expectError=25001
  begin;
  create index concurrently on customer (bonus);
  commit;
  ```
  ```sql apply expect=rows:0
  create index concurrently on customer (bonus);
  ```
  ```sql run expect=rows:1
  select indexname, idx_scan from pg_stat_user_indexes where relname = 'orders' order by indexname;
  ```
  (одна строка: `orders_pkey`, idx_scan 0; в проде так ищут кандидатов на удаление)
  ```sql apply expect=rows:0
  drop index customer_bonus_idx;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок index-maintenance"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/index-maintenance`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L12\.7\*\*/- ✅ ($(date +%F)) **L12\.7**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/12-indexes/07-index-maintenance.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 12.7 «Ненужные индексы и CONCURRENTLY»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 37. Сцена нормализации (P11.10)

Спека 4: «таблица раскалывается на две со связью». Сцена показывает 1НФ на живых данных: ячейка-список расщепляется на строки, таблица раскалывается на «сущность» и «связь». Расщепление считает Postgres (`unnest` + `string_to_array`), JS только строит кадры.

**Files:**
- Create: `src/features/scenes/split.ts`, `src/features/scenes/split.test.ts`, `src/features/lessons/mdx/SplitScene.tsx`
- Modify: `src/features/lessons/mdx/components.ts`, `tests/content/lessons.test.ts` (MDX_TAGS)

**Interfaces:**
```ts
// split.ts
export interface SplitFrame {
  left: { title: string; columns: string[]; rows: Array<{ key: string; values: unknown[] }> };
  right: { title: string; columns: string[]; rows: Array<{ key: string; values: unknown[] }> } | null;
  linkFrom: { rowIndex: number; cellIndex: number } | null;   // ячейка-список, из которой растёт связь
  caption: string;
}
export function buildSplitFrames(
  source: { title: string; columns: string[]; rows: unknown[][] },
  keyIndex: number,
  extractIndex: number,
  targetName: string,
): SplitFrame[];
```

- [ ] **Шаг 1. Падающий тест.** `src/features/scenes/split.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildSplitFrames } from './split';

  const source = {
    title: 'student',
    columns: ['id', 'name', 'hobbies'],
    rows: [
      [1, 'Анна', 'шахматы, рисование'],
      [2, 'Борис', 'плавание'],
    ],
  };

  describe('сцена нормализации', () => {
    it('три кадра: список в ячейке, расщепление, раскол на две таблицы', () => {
      const frames = buildSplitFrames(source, 0, 2, 'student_hobby');
      expect(frames).toHaveLength(3);
      // кадр 1: одна таблица, в ячейке список
      expect(frames[0]!.right).toBeNull();
      // кадр 2: ячейка расщепилась, справа мини-таблица значений
      expect(frames[1]!.right?.rows).toHaveLength(3);   // шахматы, рисование, плавание
      // кадр 3: слева student без колонки hobbies, справа student_hobby с ключом
      expect(frames[2]!.left.columns).toEqual(['id', 'name']);
      expect(frames[2]!.right?.columns).toEqual(['student_id', 'hobby']);
      expect(frames[2]!.right?.rows).toHaveLength(3);
      // связь: у каждой строки справа есть родитель слева
      expect(frames[2]!.right?.rows.every((r) => r.values[0] === 1 || r.values[0] === 2)).toBe(true);
    });
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/scenes/split.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.**
  - `split.ts`: чистая функция по интерфейсу выше: кадр 1 «нарушение 1НФ: в ячейке список», кадр 2 «ячейка расщепляется: значение = атом», кадр 3 «таблица раскалывается: сущность + связь по ключу».
  - `SplitScene.tsx`: `<SplitScene source keyColumn extract target>`: в `sandbox.preview` читает таблицу источника (`select * from <source> limit 15`) и расщепление из Postgres: `select <keyColumn>, unnest(string_to_array(<extract>, ',')) from <source> limit 200`; кадры строит `buildSplitFrames`, проигрывает `useStepper`, рендерит `MiniTable` (задача 20) с линиями связи (SVG-линии от строки слева к строкам справа).
  - `components.ts`/MDX_TAGS: добавить `SplitScene`.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`.
- [ ] **Шаг 5. Трекер и коммит.** `P11.10` → `✅ (<дата>)`.
  ```bash
  git add src/features/scenes/split.ts src/features/scenes/split.test.ts src/features/lessons/mdx/SplitScene.tsx src/features/lessons/mdx/components.ts tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(scenes): сцена нормализации: таблица раскалывается на две со связью

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 38. Урок 13.1 «Нормализация» (L13.1)

Датасет урока `empty`: таблицы создаёт сам ученик. Сцена `<SplitScene>` из задачи 37.

**Files:**
- Create: `content/lessons/13-design/01-normalization.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): 3 студента; хобби-строк после расщепления 6 (у Анны 2, у Бориса 1, у Веры 3); после раскола: `student` 3 строки без колонки `hobbies`, `student_hobby` 6 строк; join возвращает 6 строк; `string_agg` собирает списки обратно.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L13\.1\*\*/- 🔄 ($(date +%F)) **L13\.1**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'normalization'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок normalization"`. Expected: FAIL, `нет урока normalization`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.5 (нормализация); https://wiki.postgresql.org/wiki/First_normal_form и страницы PG docs по DDL: https://www.postgresql.org/docs/current/ddl-basics.html, https://www.postgresql.org/docs/current/ddl-constraints.html. Нормализация это тема реляционной теории, а не доки PG: факты форм (1НФ-3НФ) сверять с курсом и вики.
  Тезисы урока:
  - 1НФ: атомарные значения. Список в ячейке мешает искать, индексировать, считать.
  - 2НФ: неключевые колонки зависят от всего ключа, не от части.
  - 3НФ: неключевые колонки не зависят друг от друга (город не «выводится» из индекса).
  - Сцена: `<SplitScene source="student" keyColumn="id" extract="hobbies" target="student_hobby">`.
  - Превращаем сценарий в SQL: расщепление через `unnest(string_to_array(...))`, раскол на две таблицы, FK.
  - Обратный ход через `string_agg`: показывает, что нормализация ничего не теряет.
  - Не переусердствовать: JSONB для «на самом деле список» обсуждается в 5.8/13.2.
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create table student (id int primary key, name text, city text, hobbies text);
  ```
  ```sql apply expect=rows:3
  insert into student values (1, 'Анна', 'Москва', 'шахматы, рисование'), (2, 'Борис', 'Казань', 'плавание'), (3, 'Вера', null, 'шахматы, музыка, кино');
  ```
  ```sql run expect=rows:1
  select name from student where hobbies like '%музыка%';
  ```
  (текст: а вот «все, у кого хобби шахматы» уже боль: like по списку)
  ```sql run expect=rows:6
  select id, trim(unnest(string_to_array(hobbies, ','))) as hobby from student order by id;
  ```
  ```sql apply expect=rows:0
  create table student_hobby (student_id int references student, hobby text, primary key (student_id, hobby));
  ```
  ```sql apply expect=rows:6
  insert into student_hobby select id, trim(unnest(string_to_array(hobbies, ','))) from student;
  ```
  ```sql apply expect=rows:0
  alter table student drop column hobbies;
  ```
  ```sql run expect=rows:6
  select s.name, sh.hobby from student s join student_hobby sh on sh.student_id = s.id order by s.id, sh.hobby;
  ```
  ```sql run expect=rows:3
  select s.name, string_agg(sh.hobby, ', ') as hobbies
  from student s join student_hobby sh on sh.student_id = s.id
  group by s.id, s.name order by s.id;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок normalization"`. Expected: PASS (датасет empty: доска пустая, `<SplitScene>` работает по созданной таблице).
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/normalization`: сцена раскола по шагам.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L13\.1\*\*/- ✅ ($(date +%F)) **L13\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/13-design/01-normalization.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 13.1 «Нормализация»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 39. Урок 13.2 «Избыточность и денормализация» (L13.2)

**Files:**
- Create: `content/lessons/13-design/02-denormalization.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): продано книг с `sold_count >= 3` ровно 3 («Судьба человека», «Капитанская дочка», «Голова профессора Доуэля»); после `alter table ... add column sold_total` и `update` из подзапроса счётчики совпадают с живым JOIN.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L13\.2\*\*/- 🔄 ($(date +%F)) **L13\.2**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'denormalization'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок denormalization"`. Expected: FAIL, `нет урока denormalization`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.4; https://www.postgresql.org/docs/current/ddl-generated-columns.html и https://www.postgresql.org/docs/current/tutorial-window.html (для «считать на лету»).
  Тезисы урока:
  - Избыточность: сохранить то, что можно посчитать. Плюс: быстрое чтение. Минус: рассинхрон.
  - Живой подсчёт: LEFT JOIN + count. Числа-якоря.
  - Денормализация через колонку: alter + update. Опасность: вставка в order_item не обновит счётчик.
  - Генерируемые колонки: считаются сами, но только от строк своей таблицы.
  - Матвью из 10.2 как «управляемая избыточность».
  - Триггер из главы 14 как способ держать счётчик.
  - Когда денормализация оправдана: отчёты, аналитика, запись редкая, чтение частое.
  Sql-блоки урока:
  ```sql run expect=rows:3
  select b.title, count(oi.book_id) as sold
  from book b left join order_item oi on oi.book_id = b.book_id
  group by b.book_id, b.title
  having count(oi.book_id) >= 3
  order by b.book_id;
  ```
  ```sql apply expect=rows:0
  alter table book add column sold_total int not null default 0;
  ```
  ```sql apply expect=rows:11
  update book set sold_total = (select count(*) from order_item oi where oi.book_id = book.book_id);
  ```
  ```sql run expect=rows:3
  select title, sold_total from book where sold_total >= 3 order by book_id;
  ```
  (текст: тот же ответ без JOIN)
  ```sql apply expect=rows:1
  insert into order_item (order_id, book_id, qty, price) values (1, 7, 1, null) returning book_id;
  ```
  ```sql run expect=rows:1
  select sold_total from book where book_id = 7;
  ```
  (текст: в журнале новая продажа «Острова», а счётчик в book не двинулся: вот цена избыточности)
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок denormalization"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/denormalization`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L13\.2\*\*/- ✅ ($(date +%F)) **L13\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/13-design/02-denormalization.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 13.2 «Избыточность и денормализация»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 40. Урок 13.3 «Don't Do This» (L13.3)

**Files:**
- Create: `content/lessons/13-design/03-dont-do-this.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `not in` с NULL в подзапросе → 0 строк, `not exists` → 2 книги («Простой Python», «Изучаем Python»); `not in` без NULL в подзапросе тоже 0 строк (у книг без автора сам `author_id` NULL: честная ловушка трёхзначной логики).

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L13\.3\*\*/- 🔄 ($(date +%F)) **L13\.3**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'dont-do-this'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок dont-do-this"`. Expected: FAIL, `нет урока dont-do-this`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: https://wiki.postgresql.org/wiki/Don't_Do_This целиком, референс курса 12.3; для каждого пункта соответствующую страницу PG docs.
  Тезисы урока: сводный урок по PG wiki «Don't Do This». Структура: пункт → почему нельзя → пример на доске → как правильно. Обязательные пункты:
  - `not in` с NULL в подзапросе (сцена-ловушка: 0 строк против 2).
  - `char(n)` вместо text (5.3).
  - `timestamp` без пояса для мировых событий (5.4).
  - `between` с датами (полуинтервал вместо).
  - ORM-шные « select *» и индексы на каждое поле.
  - `drop table ... cascade` вслепую.
  - identifiers с кавычками и смешанным регистром.
  Sql-блоки урока (остальное текст с DontDoThis):
  ```sql run expect=rows:0
  select title from book where author_id not in (select author_id from book);
  ```
  ```sql run expect=rows:2
  select title from book b where not exists (select 1 from author a where a.author_id = b.author_id) order by b.book_id;
  ```
  ```sql run expect=rows:1
  select count(*) as n from orders where created_at >= '2024-03-01 00:00+03' and created_at < '2024-04-01 00:00+03';
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок dont-do-this"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/dont-do-this`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L13\.3\*\*/- ✅ ($(date +%F)) **L13\.3**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/13-design/03-dont-do-this.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 13.3 «Don't Do This»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 41. Лексемы FTS (часть P11.11)

Спека 4: полнотекстовый поиск, «текст разбирается на лексемы». Сцена `<LexemeScene text config>`: словарь и разбор отдаёт Postgres (`to_tsvector('russian', ...)`), JS строит кадры.

**Files:**
- Create: `src/features/scenes/lexemes.ts`, `src/features/scenes/lexemes.test.ts`, `src/features/lessons/mdx/LexemeScene.tsx`
- Modify: `src/features/lessons/mdx/components.ts`, `tests/content/lessons.test.ts` (MDX_TAGS)

**Interfaces:**
```ts
// lexemes.ts
export interface Lexeme { lexeme: string; positions: number[] }
export interface LexemeFrame {
  words: Array<{ word: string; state: 'normal' | 'stop' | 'stem' }>;
  lexemes: Lexeme[];              // не пусто со 2-го кадра
  caption: string;
}
export function buildLexemeFrames(words: string[], lexemes: Lexeme[]): LexemeFrame[];
// кадр 1: слова как есть; кадр 2: стоп-слова гаснут; кадр 3: словоформы съезжают к своей лексеме;
// кадр 4: итоговый вектор (лексема: позиции)
```

- [ ] **Шаг 1. Падающий тест.** `src/features/scenes/lexemes.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildLexemeFrames } from './lexemes';

  const words = ['Книги', 'о', 'Python:', 'читаем,', 'читали,', 'будем', 'читать'];
  const lexemes = [
    { lexeme: 'книг', positions: [1] },
    { lexeme: 'python', positions: [3] },
    { lexeme: 'чита', positions: [4, 5, 7] },
    { lexeme: 'буд', positions: [6] },
  ];

  describe('сцена лексем', () => {
    it('четыре кадра, стоп-слова гаснут, словоформы съезжаются', () => {
      const frames = buildLexemeFrames(words, lexemes);
      expect(frames).toHaveLength(4);
      // стоп-слова: о, и: позиции 2 и 5? позиция 2 это «о», её нет в лексемах
      expect(frames[1]!.words.filter((w) => w.state === 'stop').map((w) => w.word)).toEqual(['о']);
      // словоформы читаем/читали/читать съезжаются к «чита»
      expect(frames[2]!.lexemes.find((l) => l.lexeme === 'чита')?.positions).toEqual([4, 5, 7]);
      expect(frames[3]!.lexemes).toHaveLength(4);
    });
  });
  ```
  (сверено на PGlite 18.3: `unnest(to_tsvector('russian', 'Книги о Python: читаем, читали, будем читать'))` даёт лексемы `книг`/`python`/`чита`/`буд` на позициях 1/3/{4,5,7}/6; «о» стоп-слово)
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/scenes/lexemes.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.**
  - `lexemes.ts`: чистая функция по интерфейсу. Слово «стоп» если его позиция не встречается ни в одной лексеме; «stem» если позиция входит в лексему с несколькими позициями.
  - `LexemeScene.tsx`: `<LexemeScene text config>`: в `sandbox.preview` выполняет `select (lexeme, positions) from unnest(to_tsvector(<config>, $text))` (rowMode array; слова для кадра 1 получить JS-разбиением по пробелам, позиция = индекс + 1), строит кадры `buildLexemeFrames`, проигрывает `useStepper`.
  - `components.ts`/MDX_TAGS: добавить `LexemeScene`.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`.
- [ ] **Шаг 5. Коммит.**
  ```bash
  git add src/features/scenes/lexemes.ts src/features/scenes/lexemes.test.ts src/features/lessons/mdx/LexemeScene.tsx src/features/lessons/mdx/components.ts tests/content/lessons.test.ts
  git commit -m "feat(scenes): сцена лексем полнотекстового поиска

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 42. Триггер пишет в журнал (часть P11.11)

Спека 4: «INSERT в одну таблицу порождает строку в журнале». Трассировщик узнаёт о побочных эффектах триггеров и показывает их на сцене DML: строки журнала влетают в таблицу с бейджем «триггер». Тип стадии уже в контрактах (`triggerEffects`, задача 1).

**Files:**
- Create: `src/features/tracer/dml/trigger-effects.ts`, `src/features/tracer/dml/trigger-effects.test.ts`, `src/features/overlay/animators/side-effects.ts`, `src/features/overlay/animators/side-effects.test.ts`
- Modify: трассировщик DML (Ф9, найти: `grep -rn "cascades" src/features/tracer/dml`), `src/features/overlay/playback.ts` (ANIMATORS)

**Interfaces:**
```ts
// trigger-effects.ts
export interface TriggerEffect { tableId: string; triggers: string[]; added: Relation }
export function findTriggerTables(schema: SchemaSnapshot, tableId: string): string[];
// таблицы, у которых есть AFTER-триггеры, ссылающиеся на tableId (по pg_trigger через каталог интроспекции);
// в SchemaSnapshot триггеров нет: читаем каталог на месте, function findTriggerTables(db, schema, tableId)
export async function collectTriggerEffects(
  db: DbClient, tableId: string, affected: () => Promise<void>, schema: SchemaSnapshot,
): Promise<TriggerEffect[]>;
// внутри preview: снимок строк таблиц-журналов до affected(), потом affected(), потом снимок после;
// разница по всем колонкам (кроме изменяющихся now()/default: сравнивать без колонок типа timestamptz default now()).
```

- [ ] **Шаг 1. Падающий тест.** `src/features/tracer/dml/trigger-effects.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { withDataset, inPreview } from '../../../../tests/helpers/db';
  import { collectTriggerEffects } from './trigger-effects';
  import { introspect } from '@/features/db/introspect';

  describe('побочные эффекты триггеров', () => {
    it('UPDATE цены пишет строку в журнал', async () => {
      await withDataset('bookstore', async (db) => {
        await db.exec(`
          create table price_log (book_id bigint, old_price numeric, new_price numeric, changed_at timestamptz default now());
          create function log_price_change() returns trigger language plpgsql as
            $$ begin
              insert into price_log values (new.book_id, old.price, new.price);
              return new;
            end $$;
          create trigger book_price_log after update on book
            for each row when (old.price is distinct from new.price)
            execute function log_price_change();
        `);
        const schema = await introspect(db);
        const effects = await inPreview(db, () =>
          collectTriggerEffects(db, 'public.book', async () => {
            await db.exec('update book set price = price + 10 where book_id = 1');
          }, schema),
        );
        expect(effects).toHaveLength(1);
        expect(effects[0]).toMatchObject({ tableId: 'public.price_log', triggers: ['book_price_log'] });
        // в журнале одна строка: 890.00 → 900.00
        expect(effects[0]!.added.rows).toHaveLength(1);
        expect(effects[0]!.added.rows[0]!.values[0]).toBe(1);
        expect(effects[0]!.added.rows[0]!.values[1]).toBe('890.00');
        expect(effects[0]!.added.rows[0]!.values[2]).toBe('900.00');
      });
    }, 60_000);
  });
  ```
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/tracer/dml/trigger-effects.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.**
  - `trigger-effects.ts`: `findTriggerTables` через `pg_trigger` + `pg_depend` (таблица с триггером AFTER INSERT/UPDATE/DELETE, зависящим от `tableId`); `collectTriggerEffects` по интерфейсу: снимок до/после, diff строк, `added` как `Relation` (колонки из каталога, lineage `#n`).
  - Трассировщик DML: для UPDATE/DELETE/INSERT по таблице с триггерами вызвать `collectTriggerEffects` (сама операция уже выполняется трассировщиком внутри preview: обернуть его выполнение в `affected`) и записать `stage.triggerEffects`.
  - `side-effects.ts`: аниматор поверх `dml`-стадии: после основного эффекта DML строки `added` влетают в призрак таблицы журнала с бейджем «триггер <имя>» и линией от изменённой строки. Подпись: `«триггер book_price_log: +1 строка в price_log»`.
  - `playback.ts`: аниматор dml Ф9 получает пост-обработку `triggerEffects` (не отдельная стадия).
- [ ] **Шаг 4. Запуск.** Тест PASS, аниматор-тест (чистый, по образцу задачи 7: фаза с призраком журнала и бейджем) PASS, `pnpm check`.
- [ ] **Шаг 5. Коммит.**
  ```bash
  git add src/features/tracer/dml/trigger-effects.ts src/features/tracer/dml/trigger-effects.test.ts src/features/overlay/animators/side-effects.ts src/features/overlay/animators/side-effects.test.ts src/features/tracer/dml src/features/overlay/playback.ts
  git commit -m "feat(tracer): побочные эффекты триггеров в трассе и на сцене DML

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 43. Маршрутизация строки по партициям (часть P11.11)

Спека 4: «строка маршрутизируется в нужную секцию». INSERT в партиционированную таблицу расщепляется: строки уходят в свои секции, путь виден на доске. Тип стадии `routing` уже в контрактах (задача 1). Проверенные факты (PGlite 18.3, 2026-10-08): `insert into measurement values (1, '2024-05-10', 20), (1, '2024-06-15', 25)` раскладывает строки по `measurement_2024_05`/`measurement_2024_06`, маршрутизация видна через `tableoid::regclass`; вставка вне диапазона секций → `23514` `no partition of relation "measurement" found for row`.

**Files:**
- Create: `src/features/tracer/dml/routing.ts`, `src/features/tracer/dml/routing.test.ts`
- Modify: трассировщик DML (Ф9), `src/features/overlay/animators/side-effects.ts` (кадр расщепления по секциям)

**Interfaces:**
```ts
// routing.ts
export interface RoutedRow { values: unknown[]; partitionId: string }
export async function collectRouting(
  db: DbClient, tableId: string, insertSelect: string, schema: SchemaSnapshot,
): Promise<RoutedRow[] | null>;
// tableId не партиционирован → null. Внутри preview:
// create temp table __vs_route as select tableoid, <колонки> from (<insert-select>) s;
// строки + имя секции из tableoid::regclass
```

- [ ] **Шаг 1. Падающий тест.** `src/features/tracer/dml/routing.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { withDataset, inPreview } from '../../../../tests/helpers/db';
  import { collectRouting } from './routing';

  describe('маршрутизация по партициям', () => {
    it('строки INSERT расходятся по секциям, вне диапазона ошибка', async () => {
      await withDataset('bookstore', async (db) => {
        await db.exec(`
          create table measurement (city_id int not null, logdate date not null, peaktemp int)
            partition by range (logdate);
          create table measurement_2024_05 partition of measurement
            for values from ('2024-05-01') to ('2024-06-01');
          create table measurement_2024_06 partition of measurement
            for values from ('2024-06-01') to ('2024-07-01');
        `);
        const rows = await inPreview(db, () =>
          collectRouting(
            db,
            'public.measurement',
            "select 1 as city_id, '2024-05-10'::date as logdate, 20 as peaktemp union all select 1, '2024-06-15'::date, 25",
            await import('@/features/db/introspect').then((m) => m.introspect(db)),
          ),
        );
        expect(rows).toEqual([
          { values: [1, '2024-05-10', 20], partitionId: 'public.measurement_2024_05' },
          { values: [1, '2024-06-15', 25], partitionId: 'public.measurement_2024_06' },
        ]);
      });
    }, 60_000);
  });
  ```
  (значения date сравнить как строки; порядок строк сохранить `union all` без order? порядок `union all` сохраняется на практике, но честнее дописать `order by logdate` в insert-select.)
- [ ] **Шаг 2. Запуск.** `pnpm vitest run --project node src/features/tracer/dml/routing.test.ts`. FAIL: модуля нет.
- [ ] **Шаг 3. Код.**
  - `routing.ts` по интерфейсу: партиционированность проверить по `pg_class.relkind = 'p'`; `insertSelect` для `insert ... values` строится из списка значений трассировщиком, для `insert ... select` берётся подзапрос как есть.
  - Трассировщик DML: INSERT в партиционированную таблицу получает `stage.routing` (колонки для подписи: ключ партиционирования).
  - `side-effects.ts`: кадр: вставляемые строки расщепляются по рамкам секций (секции как вложенные таблицы с пунктиром, как у CTE Ф10), подпись `«2 строки → 2 секции по logdate»`. Вставка вне диапазона остаётся обычной стадией `error` с `23514`.
- [ ] **Шаг 4. Запуск.** Тест PASS, `pnpm check`. Урок проверит сцену глазами (задача 48).
- [ ] **Шаг 5. Трекер и коммит.** `P11.11` → `✅ (<дата>)` (закрыт задачами 41-43).
  ```bash
  git add src/features/tracer/dml/routing.ts src/features/tracer/dml/routing.test.ts src/features/tracer/dml src/features/overlay/animators/side-effects.ts docs/PROGRESS.md
  git commit -m "feat(tracer): маршрутизация строк INSERT по секциям партиций

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 44. Урок 14.1 «Полнотекстовый поиск» (L14.1)

**Files:**
- Create: `content/lessons/14-extras/01-full-text-search.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `to_tsvector('russian', 'Великий роман о донском казачестве. Читается на одном дыхании.')` → лексемы `велик, донск, дыхан, казачеств, одн, рома, чита` (7 лексем, «о» выброшено); `@@ plainto_tsquery('russian', 'фантастика')` по телам отзывов → 2 отзыва (книги 6 и 8); после генерируемой колонки `body_tsv` + GIN: `@@ plainto_tsquery('russian', 'книга python')` → 1 отзыв (книга 2, rating 5); `ts_rank` книги 2 → 0.0985, у остальных ~0.
- Потребляет: `<LexemeScene>` из задачи 41.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.1\*\*/- 🔄 ($(date +%F)) **L14\.1**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'full-text-search'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок full-text-search"`. Expected: FAIL, `нет урока full-text-search`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.29; https://www.postgresql.org/docs/current/textsearch-intro.html и https://www.crunchydata.com/blog/postgres-full-text-search-a-search-engine-in-a-database.
  Тезисы урока:
  - LIKE/ILIKE ищут подстроку, FTS ищет смысл: словоформы, регистр, стоп-слова, ранжирование.
  - `to_tsvector` разбирает текст на лексемы (сцена `<LexemeScene text="Великий роман о донском казачестве. Читается на одном дыхании." config="russian">`).
  - `to_tsquery`/`plainto_tsquery`: запрос в лексемы; `@@` сопоставляет.
  - Хранить вектор: генерируемая колонка + GIN-индекс.
  - `ts_rank`: сортировка по релевантности.
  - Когда хватает pg_trgm из 12.6, а когда FTS.
  Sql-блоки урока:
  ```sql run expect=rows:1
  select to_tsvector('russian', 'Великий роман о донском казачестве. Читается на одном дыхании.') as v;
  ```
  ```sql run expect=rows:2
  select book_id, rating from review
  where to_tsvector('russian', body) @@ plainto_tsquery('russian', 'фантастика')
  order by book_id;
  ```
  ```sql apply expect=rows:0
  alter table review add column body_tsv tsvector
    generated always as (to_tsvector('russian', body)) stored;
  ```
  ```sql apply expect=rows:0
  create index on review using gin (body_tsv);
  ```
  ```sql run expect=rows:1
  select book_id, rating from review
  where body_tsv @@ plainto_tsquery('russian', 'книга python')
  order by book_id;
  ```
  ```sql run expect=rows:3
  select book_id, round(ts_rank(body_tsv, plainto_tsquery('russian', 'книга python'))::numeric, 4) as rank
  from review
  order by rank desc, book_id
  limit 3;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок full-text-search"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/full-text-search`: сцена лексем по шагам.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.1\*\*/- ✅ ($(date +%F)) **L14\.1**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/01-full-text-search.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.1 «Полнотекстовый поиск»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 45. Урок 14.2 «Функции и процедуры» (L14.2)

**Files:**
- Create: `content/lessons/14-extras/02-functions.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `add_bonus(1, 10)` → 130 (бонус Анны 120); `add_bonus(1, 0)` → 120; функция на SQL и на PL/pgSQL обе создаются.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.2\*\*/- 🔄 ($(date +%F)) **L14\.2**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'functions'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок functions"`. Expected: FAIL, `нет урока functions`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.41, 12.42; https://www.postgresql.org/docs/current/sql-createfunction.html и https://www.postgresql.org/docs/current/xfunc-sql.html.
  Тезисы урока:
  - Функция: вход → выход, вызывается внутри SELECT. Процедура: шаг программы, CALL вне SELECT.
  - SQL-функция: тело это запрос, планировщик может её «вклеить» в запрос.
  - PL/pgSQL: переменные, ветвления, циклы; для логики.
  - Волатильность: immutable/stable/volatile и почему от неё зависит использование в индексах.
  - Именованные аргументы: `add_bonus(customer_id => 1, amount => 10)`.
  - Порядок блоков: apply создаёт, run вызывает.
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create function add_bonus(p_customer_id int, p_amount int) returns int
  language sql as
    $$ select bonus + p_amount from customer where customer.customer_id = p_customer_id $$;
  ```
  ```sql run expect=rows:1
  select add_bonus(1, 10) as new_bonus;
  ```
  ```sql run expect=rows:1
  select add_bonus(1, 0) as same_bonus;
  ```
  ```sql apply expect=rows:0
  create function bonus_label(p_customer_id int) returns text
  language plpgsql as
    $$
      declare
        b int;
      begin
        select bonus into b from customer where customer_id = p_customer_id;
        if b > 0 then return 'бонус: ' || b; end if;
        return 'без бонуса';
      end
    $$;
  ```
  ```sql run expect=rows:1
  select bonus_label(1) as label;
  ```
  ```sql noexec
  call some_procedure(1);   -- процедуры вызываются CALL, внутри транзакции; пример в шпаргалке
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок functions"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/functions`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.2\*\*/- ✅ ($(date +%F)) **L14\.2**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/02-functions.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.2 «Функции и процедуры»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 46. Урок 14.3 «Триггеры» (L14.3)

**Files:**
- Create: `content/lessons/14-extras/03-triggers.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): после `update book set price = price + 10 where book_id = 1` в `price_log` одна строка `890.00 → 900.00`; UPDATE без изменения цены (WHEN отсекает) новых строк не пишет: в журнале по-прежнему 1.
- Потребляет: `triggerEffects` из задачи 42: сцена DML показывает влет строки в журнал.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.3\*\*/- 🔄 ($(date +%F)) **L14\.3**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'triggers'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок triggers"`. Expected: FAIL, `нет урока triggers`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.43; https://www.postgresql.org/docs/current/triggers.html и https://www.postgresql.org/docs/current/plpgsql-trigger.html.
  Тезисы урока:
  - Триггер = событие (insert/update/delete) + момент (before/after) + функция. «INSERT в одну таблицу порождает строку в журнале».
  - Журнал изменений цен: таблица `price_log`, функция `log_price_change`, триггер с WHEN.
  - На доске: у UPDATE появляется вторая сцена: строка влетает в журнал с бейджем «триггер».
  - BEFORE может менять NEW (нормализация телефона) или вернуть NULL (отклонить).
  - FOR EACH ROW vs STATEMENT: переходный эффект.
  - WHEN-условие: триггер не сработал на «цена не изменилась».
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create table price_log (book_id bigint, old_price numeric, new_price numeric, changed_at timestamptz default now());
  ```
  ```sql apply expect=rows:0
  create function log_price_change() returns trigger language plpgsql as
    $$ begin
      insert into price_log values (new.book_id, old.price, new.price);
      return new;
    end $$;
  ```
  ```sql apply expect=rows:0
  create trigger book_price_log after update on book
    for each row when (old.price is distinct from new.price)
    execute function log_price_change();
  ```
  ```sql apply expect=rows:1
  update book set price = price + 10 where book_id = 1 returning title, price;
  ```
  ```sql run expect=rows:1
  select book_id, old_price, new_price from price_log;
  ```
  ```sql apply expect=rows:1
  update book set price = price where book_id = 1 returning title, price;
  ```
  ```sql run expect=rows:1
  select count(*) as n from price_log;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок triggers"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/triggers`: сцена DML с побочным эффектом.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.3\*\*/- ✅ ($(date +%F)) **L14\.3**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/03-triggers.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.3 «Триггеры»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 47. Урок 14.4 «Роли и права» (L14.4)

**Files:**
- Create: `content/lessons/14-extras/04-roles.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): в `review` 10 отзывов; под ролью с правом только SELECT: `count(*)` работает, INSERT даёт `42501 permission denied for table review`.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.4\*\*/- 🔄 ($(date +%F)) **L14\.4**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'roles'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок roles"`. Expected: FAIL, `нет урока roles`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 11.12, 12.49; https://www.postgresql.org/docs/current/user-manag.html и https://www.postgresql.org/docs/current/sql-grant.html.
  Тезисы урока:
  - Роль это и «пользователь», и «группа». Вход в базу это роль с LOGIN.
  - Права на объекты: grant/revoke таблицам, схемам, функциям. По умолчанию у Postgres только владелец.
  - В песочнице одна роль, чужие права проверяем через `set role` (Ф0 проверил: 42501).
  - Аудитор: роль с правом читать отзывы и писать ничего.
  - PUBLIC, default privileges, ALTER DEFAULT PRIVILEGES обзорно.
  - Принцип минимальных прав; отдельная роль для приложения без DDL.
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create role auditor noinherit;
  ```
  ```sql apply expect=rows:0
  grant select on review to auditor;
  ```
  ```sql apply expect=rows:1
  set role auditor;
  select count(*) as n from review;
  reset role;
  ```
  ```sql apply expectError=42501
  set role auditor;
  insert into review (book_id, customer_id, rating, body) values (1, 1, 5, 'аудитор пишет');
  reset role;
  ```
  (блок падает на INSERT с 42501; задача 3 гарантирует чистую сессию после)
  ```sql apply expect=rows:0
  revoke select on review from auditor;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок roles"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/roles`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.4\*\*/- ✅ ($(date +%F)) **L14\.4**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/04-roles.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.4 «Роли и права»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 48. Урок 14.5 «Партиционирование» (L14.5)

**Files:**
- Create: `content/lessons/14-extras/05-partitioning.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): вставка двух строк (2024-05-10 и 2024-06-15) расходится по `measurement_2024_05`/`measurement_2024_06`, видна через `tableoid::regclass`; вставка `2024-04-01` вне диапазона → `23514`; после default-партиции такая вставка проходит.
- Потребляет: `routing` из задачи 43: сцена INSERT расщепляет строки по секциям.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.5\*\*/- 🔄 ($(date +%F)) **L14\.5**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'partitioning'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок partitioning"`. Expected: FAIL, `нет урока partitioning`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.34; https://www.postgresql.org/docs/current/ddl-partitioning.html.
  Тезисы урока:
  - Одна логическая таблица, много физических секций. Правило маршрутизации: range по дате (обзорно list и hash).
  - Зачем: быстрые удаления (detach), компактные индексы, архивирование старых секций.
  - Создание: родитель `partition by range`, секции с границами. Вставка: строки уходят в свою секцию (сцена на доске).
  - `tableoid::regclass` показывает, куда легла строка.
  - Строка вне диапазонов: 23514. Default-секция ловит всё.
  - PK обязан включать ключ партиционирования.
  Sql-блоки урока:
  ```sql apply expect=rows:0
  create table measurement (city_id int not null, logdate date not null, peaktemp int)
    partition by range (logdate);
  ```
  ```sql apply expect=rows:0
  create table measurement_2024_05 partition of measurement
    for values from ('2024-05-01') to ('2024-06-01');
  create table measurement_2024_06 partition of measurement
    for values from ('2024-06-01') to ('2024-07-01');
  ```
  ```sql apply expect=rows:2
  insert into measurement values (1, '2024-05-10', 20), (1, '2024-06-15', 25);
  ```
  ```sql run expect=rows:2
  select tableoid::regclass as part, city_id, logdate, peaktemp from measurement order by logdate;
  ```
  ```sql apply expectError=23514
  insert into measurement values (1, '2024-04-01', 20);
  ```
  ```sql apply expect=rows:0
  create table measurement_default partition of measurement default;
  ```
  ```sql apply expect=rows:1
  insert into measurement values (1, '2024-04-01', 20);
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок partitioning"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/partitioning`: сцена расщепления INSERT по секциям.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.5\*\*/- ✅ ($(date +%F)) **L14\.5**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/05-partitioning.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.5 «Партиционирование»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 49. Урок 14.6 «Размер БД, системные каталоги» (L14.6)

**Files:**
- Create: `content/lessons/14-extras/06-sizes-catalogs.mdx`
- Modify: `tests/content/lessons.test.ts`, `docs/PROGRESS.md`

**Interfaces:**
- Числа-якоря (сверены): `pg_total_relation_size` по `book` → 32 kB (с PK), по `order_item` → 24 kB; в `pg_class` около 453 строки (число плавает с созданными объектами: ожидание только на «1 строка» у агрегатов); `pg_catalog` содержит сотни таблиц-каталогов.

- [ ] **Шаг 1. Взять пункт в работу.** `sed -i '' -E "s/^- ⬜ \*\*L14\.6\*\*/- 🔄 ($(date +%F)) **L14\.6**/" docs/PROGRESS.md`
- [ ] **Шаг 2. Падающий контентный тест.** Дописать `'sizes-catalogs'` в `GUIDE_LESSONS`. Run: `pnpm test:content -t "урок sizes-catalogs"`. Expected: FAIL, `нет урока sizes-catalogs`.
- [ ] **Шаг 3. Прочитать источники и написать урок.**
  Прочитать: курс 12.44; https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-DBOBJECT и https://www.postgresql.org/docs/current/catalogs.html.
  Тезисы урока:
  - `pg_total_relation_size`: таблица + индексы + TOAST; `pg_relation_size`: только кучи. Разница на `book`.
  - `pg_size_pretty` для человека.
  - Каталоги: метаданные самих себя. `pg_class` (отношения), `pg_attribute` (колонки), `pg_index` (индексы), `pg_proc` (функции). Все прошлые сцены (MVCC, B-дерево, статистика) читали именно каталоги.
  - information_schema: стандартный SQL-вид тех же данных.
  - Мониторинг роста: продакшен-запрос «топ таблиц по размеру».
  Sql-блоки урока:
  ```sql run expect=rows:2
  select relname, pg_size_pretty(pg_total_relation_size(oid)) as size
  from pg_class
  where relname in ('book', 'order_item') and relkind = 'r'
  order by relname;
  ```
  ```sql run expect=rows:1
  select pg_size_pretty(pg_total_relation_size('public.book')) as total,
         pg_size_pretty(pg_relation_size('public.book')) as heap;
  ```
  ```sql run expect=rows:1
  select count(*) as n from pg_class;
  ```
  ```sql run expect=rows:1
  select count(*) as n from pg_class where relnamespace = 'pg_catalog'::regnamespace;
  ```
  ```sql run expect=rows:3
  select table_name from information_schema.tables
  where table_schema = 'pg_catalog' order by table_name limit 3;
  ```
- [ ] **Шаг 4. Раннер зелёный.** Run: `pnpm test:content -t "урок sizes-catalogs"`. Expected: PASS.
- [ ] **Шаг 5. Сцены глазами.** `pnpm dev`, `http://localhost:5199/l/sizes-catalogs`.
- [ ] **Шаг 6. Трекер и коммит.**
  ```bash
  sed -i '' -E "s/^- (⬜|🔄 \([0-9-]+\)) \*\*L14\.6\*\*/- ✅ ($(date +%F)) **L14\.6**/" docs/PROGRESS.md
  pnpm check
  git add content/lessons/14-extras/06-sizes-catalogs.mdx tests/content/lessons.test.ts docs/PROGRESS.md
  git commit -m "feat(content): урок 14.6 «Размер БД и системные каталоги»

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Задача 50. Закрытие фазы

**Files:**
- Modify: `docs/PROGRESS.md`

**Interfaces:** нет нового кода. Проверка, что всё закрыто и ничего не забыто.

- [ ] **Шаг 1. Проверить Review Focus.** Пройти по пяти пунктам раздела Review Focus глазами и тестами:
  1. `pnpm vitest run --project node src/features/tracer/srf.test.ts`.
  2. CI-джоба `sessions` зелёная (или локально с Docker: `VS_PG_DSN=... pnpm vitest run --project node src/features/sessions/scenarios.pg.test.ts`).
  3. `pnpm vitest run --project node src/features/db/pageinspect.test.ts`.
  4. `pnpm vitest run --project node src/features/tracer/explain.test.ts`.
  5. `pnpm vitest run --project node src/features/db/views.test.ts`.
- [ ] **Шаг 2. Полный прогон.** `pnpm check`, затем `pnpm test:content` (все 37 уроков фазы зелёные), затем `pnpm e2e` (если e2e-сьют Ф8-Ф10 ломается из-за вкладки «План», чинить в задаче 28, а не здесь).
- [ ] **Шаг 3. Трекер.** Убедиться, что в разделе Ф11 все пункты P11.1-P11.12 и L5.1-L14.6 в ✅ с датами, пункт P11.1 (план) закрыт датой согласования, фаза Ф11 в сводке вывелась ✅ (правило 6 трекера). Незакрытые пункты не «закрывать массово»: каждый либо закрыт своей задачей, либо ⚠️ с заметкой.
- [ ] **Шаг 4. Коммит.**
  ```bash
  git add docs/PROGRESS.md
  git commit -m "chore(phase): Ф11 закрыта: 37 уроков и 10 визуальных механизмов

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

## Покрытие пунктов трекера

| Пункт | Задача | Что закрывается |
| --- | --- | --- |
| P11.1 | этот файл | план фазы (закрывается датой согласования) |
| P11.2 | 6, 7 | стадия `expand` + аниматоры unnest/jsonb |
| P11.3 | 17 | VIEW стеклянной рамкой, MATERIALIZED VIEW с отставанием |
| P11.4 | 20 | MVCC-сцена через pageinspect |
| P11.5 | 21 | движок сцен «две сессии», формат сценария, таймлайн |
| P11.6 | 22 | CI-джоба `sessions` на Postgres 18 в Docker |
| P11.7 | 4, 5 (уже в плане) | датасет big_bookstore + сжатый вид таблиц |
| P11.8 | 29 | B-дерево, Seq vs Index Scan, счётчик прочитанных строк |
| P11.9 | 28 | вкладка «План», связь узла со стадией |
| P11.10 | 37 | сцена нормализации |
| P11.11 | 41, 42, 43 | лексемы FTS, триггер в журнал, маршрутизация по партициям |
| P11.12 | 1 (уже в плане) | правки контрактов |
| L5.1-L5.9 | 8-16 | уроки 5.1-5.9 |
| L10.1, L10.2 | 18, 19 | уроки 10.1-10.2 |
| L11.1-L11.5 | 23-27 | уроки 11.1-11.5 |
| L12.1-L12.7 | 30-36 | уроки 12.1-12.7 |
| L13.1-L13.3 | 38-40 | уроки 13.1-13.3 |
| L14.1-L14.6 | 44-49 | уроки 14.1-14.6 |

Итого: 50 задач, 35 уроков, 12 пунктов трекера (10 визуальных механизмов + правки контрактов + план).

## Отклонения от контрактов

Правки контрактов (типы `expand`, `plan`, `triggerEffects`, `routing`, `viewDeps`, `matviewLag`, `hoveredStage`, MDX-компоненты сцен, `pg` для CI, уточнение ожиданий многооператорного блока) вносит задача 1 отдельным коммитом `docs(contracts): ...` до кода. Дополнительные отклонения:

1. **Сцены MVCC и «триггер-журнал» работают через `sandbox.client()`, а не `sandbox.preview`.** MVCC-сцена обязана выполнить VACUUM (25001 в транзакции) и увидеть закоммиченные мёртвые версии, то есть выйти за `BEGIN ... ROLLBACK`. Решение: сцена создаёт собственные таблицы `vs_mvcc`, `vs_parent`, `vs_child` в autocommit и DROP-ает их в конце; пользовательские данные урока не меняются, журнал применённых операторов не трогается. Инвариант «превью только в BEGIN ... ROLLBACK» соблюдён по духу: единственный источник изменений данных урока остаётся «Применить». Контракты не правились: `Sandbox.client()` публичен по разделу 4, запрет в контрактах описывает только превью-режим. B-дерево, лексемы, нормализация и лексемы FTS работают read-only внутри preview.
2. **Уроки 11.х используют apply-блоки для многооператорных блоков с `commit`.** Превью оборачивает блок в `BEGIN ... ROLLBACK`, и явный `commit` внутри отменил бы изоляцию примеров. Правило: блок с фиксацией идёт через apply (кнопка «Применить»), блок с откатом остаётся run-блоком. Об этом написано в тексте урока 11.1; контракт меняет только задача 1 (ожидание по последнему оператору).
3. **Проверка `mvp: true` в тесте контента расходится с новыми уроками.** Список уроков по гайду разделён на `MVP_LESSONS` (13 уроков Ф8, проверка `mvp`) и `GUIDE_LESSONS` (все написанные уроки, без `mvp`). Правка теста контента внесена в задачу 8 как часть падающего теста; это правка теста, не контрактов.

Других отклонений нет: имена, сигнатуры и раскладка файлов соответствуют контрактам (с учётом правок задачи 1).
