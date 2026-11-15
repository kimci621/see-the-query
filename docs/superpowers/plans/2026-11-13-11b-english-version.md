# Ф11б Английская версия: план реализации

> Для исполнителя: использовать `superpowers:executing-plans`. Выполнять задачи и уроки последовательно, в основном цикле. К реализации переходить после согласования этого плана.

**Цель:** приложение и все уроки основной программы доступны на русском и английском; SQL-примеры и сцены работают на обеих версиях учебных данных.

**Архитектура:** язык хранится в настройках и в параметре `lang` текущего URL. Русские и английские уроки связаны общим `id`, но имеют отдельные MDX-файлы. Учебные данные и рабочее состояние песочницы разделены по языкам; отметки о прохождении уроков общие. Трассировщик и аниматоры получают язык явно, без зависимости от React.

**Стек:** существующие React, React Router, TypeScript, Zustand, Vite, MDX, PGlite, Vitest и Playwright. Новые зависимости не нужны.

**Спека:** `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, разделы 3, 4, 5.1, 5.10-5.12, 5.14, 6, 8, 10 и 11. Контракты: `docs/superpowers/plans/2026-10-08-00-contracts.md`. Стиль уроков: `docs/content-style.md`. Очерёдность и статусы: `docs/PROGRESS.md`.

## Решения для согласования

1. **URL и настройки.** Старый `/l/inner-join` продолжает открываться. Если в ссылке есть `?lang=ru` или `?lang=en`, язык ссылки главнее сохранённого и становится настройкой. Без параметра берётся настройка, а при первом заходе русский. Адрес нормализуется через `replace`, чтобы в нём появился выбранный язык. Неизвестное значение и повреждённая настройка не ломают страницу: берётся допустимая настройка, иначе `ru`. Переключатель добавляет запись в историю, меняет язык в URL и настройках, сохраняет текущий урок и остальные параметры URL; переход по истории браузера возвращает язык из URL. Внутренние ссылки ведут на тот же язык. `<html lang>` соответствует открытому языку.
2. **Данные.** Английская версия получает английские названия, имена, города, отзывы, теги и другие учебные текстовые значения. Русские файлы остаются источником русской версии. SQL-идентификаторы, ключи строк, схема, связи, NULL, числа, даты, enum и особые случаи сохраняются. Значения вроде `meta.lang`, когда они являются предметом запроса, не меняются автоматически. `events` использует английскую основу `bookstore`, `empty` общий, для `big_bookstore` готовится английский вариант. Результаты текстовых фильтров, порядок сортировки и полнотекстовый поиск пересчитываются в Postgres: перевод строк может их изменить.
3. **Рабочее состояние.** Отметки о посещении и прохождении общие для одного `id`. Последний SQL, журнал применённых команд и положение камеры хранятся отдельно для `ru` и `en`. Первый переход на английский открывает английские данные и начальный запрос; возврат на русский восстанавливает прежнюю русскую песочницу. Это нужно, потому что SQL-команда может содержать строку из русских данных. Интерфейс сообщает о двух отдельных песочницах возле переключателя языка.
4. **Подписи и ошибки.** Все сообщения приложения, включая стадии, кадры, fallback, сценарии двух сессий, доступные имена и тосты, выводятся на выбранном языке. Оригинальный текст PostgreSQL остаётся дословным и доступен в карточке ошибки. Результаты запросов, пользовательский SQL и идентификаторы не переводятся автоматически.
5. **Уроки.** Русские файлы остаются в `content/lessons/`; английские располагаются в `content/lessons-en/` с теми же именами. Общие `id`, номер, глава, порядок, датасет и настройки доски совпадают. Название, теги, подписи ссылок, текст, подписи сцен и SQL-литералы переводятся или адаптируются. В период перевода отсутствующая английская версия показывает английское сообщение о незавершённом переводе, а не русский урок. К завершению фазы таких страниц не остаётся.

Рассмотрены общие русские данные и отдельные версии. Общие данные сохраняют одну песочницу, но оставляют русский текст на доске и в выводе; отдельные дают английские примеры, ценой отдельных журналов и повторной проверки SQL. Параметр URL выбран вместо новых `/en/...`-маршрутов: он сохраняет действующие пути и не требует второго дерева маршрутов.

## Общие ограничения

- Начало реализации: Ф11 завершена, этот план согласован. До изменения действующих контрактов сначала выполнить задачу 1.
- Не менять инварианты из `CLAUDE.md`: PostgreSQL остаётся источником результатов и ошибок, превью откатывается, итог трассы сверяется с реальным запросом, базовая доска не анимируется.
- Комментарии в коде на русском; текст продукта на выбранном языке. Не устанавливать зависимости без отдельного согласования.
- Один пункт трекера одновременно в работе. Уроки переводятся по одному: весь DoD одного урока и коммит до следующего. Текст курса-референса не копируется.
- Каждый коммит только после `pnpm check`. При закрытии пункта его статус и дата входят в тот же коммит. Для каждого урока также проходят `pnpm test:content` и проверка всех его сцен глазами.
- Во время постепенного перевода `pnpm test:content` проверяет все существующие русские и английские уроки. Неполное покрытие явно допускается только до финальной задачи; в ней проверка наличия пары для каждого русского урока включается в обычный `pnpm test:content` и CI.
- Текущий срез: 93 русских урока, главы 0-14. Перед началом задачи 7 заново собрать список из реестра; при добавлении русского урока добавить его в этот же перечень и перевести до закрытия фазы.

## Риски для проверки

1. Старая ссылка или сохранённые настройки меняют язык неожиданно. Закрепить тестами приоритет URL, настройки, отсутствие и неверное значение параметра, переход назад и прямой вход в урок (задача 2).
2. Переключение удаляет журнал, незапущенный SQL или поднимает данные другого языка. Проверить миграцию старого `vs-lessons`, быстрое переключение, возврат, перезагрузку и ошибку загрузки (задача 4).
3. Вложенная трасса, кадр, fallback или SQLSTATE остаётся на русском, а английский суффикс ошибочно добавляется к русскому тексту. Проверить обычный SELECT, JOIN, CTE/подзапрос, DML, ошибку и `final-only` вместе с кадрами и `aria-live` (задача 3).
4. Перевод данных меняет `LIKE`, сортировку, `jsonb`, полнотекстовый поиск или ожидаемый результат. Проверять оба датасета на настоящем Postgres и выполнять каждый переведённый SQL-блок на его версии данных (задачи 4, 6 и 7).
5. Английский реестр молча теряет урок, переиспользует кэш русского MDX или не показывает новые сцены Ф11. Проверить пары `id`, ключ кэша по языку и переходы туда-обратно; включить обязательную проверку полноты в CI (задачи 2 и 8).

## Карта файлов

Создать:
- `src/lib/i18n.ts`, `src/lib/messages.ts`: тип языка, функции выбора языка и типизированные сообщения без React.
- `src/features/shell/LanguageToggle.tsx`: доступный переключатель.
- `content/datasets/en/bookstore.sql`, `content/datasets/en/big_bookstore.sql`: английские данные.
- `content/scenarios/localize.ts`: английские подписи подготовленных сценариев и выбор текста по языку.
- `content/lessons-en/<chapter>/<lesson>.mdx`: английский файл для каждого русского урока.
- Точечные тесты языка, переходов и данных рядом с модулями; `tests/e2e/english.spec.ts` для сквозных сценариев.

Изменить:
- `docs/superpowers/specs/2026-10-08-visual-sql-design.md`, `docs/superpowers/plans/2026-10-08-00-contracts.md`, `CLAUDE.md`, `docs/content-style.md`, `docs/datasets.md`, `docs/PROGRESS.md`.
- `src/app/router.tsx`, `src/stores/settings.ts`, `src/stores/lesson.ts`, `src/features/shell/*`, `src/features/lessons/{registry,types,LessonView}.ts*`, `src/features/lessons/mdx/*`, `content/chapters.ts`, `plugins/lessons-meta.ts`, `src/virtual-modules.d.ts`.
- `src/features/db/{datasets,sandbox,useLessonSandbox}.ts`, связанные вызовы в редакторе и доске, `tests/helpers/db.ts`.
- `src/features/tracer/{types,captions,trace,whitelist}.ts` и вызываемые построители стадий; `src/features/overlay/{types,playback,animators}/*`, `src/features/timeline/*`, `src/features/errors/*`, `src/features/results/*`, `src/features/scenes/*`, `src/features/sessions/*`, `content/scenarios/*`.
- `tests/content/lessons.test.ts`, тесты метаданных и навигации; `.github/workflows/ci.yml` только если текущей команды проверки контента для обязательного контроля пар недостаточно.

Список директорий задаёт места поиска, а не разрешение менять все файлы. В каждом модуле менять только строки и интерфейсы, нужные для языка.

## Task 1: Обновить спецификацию и контракты

**Трекер:** добавить новый пункт `P11б.7` для правок контрактов; `P11б.1` закрыть после согласования плана. На время правок в работе только `P11б.7`.

**Файлы:** `docs/PROGRESS.md`, основная спека, контракты и `CLAUDE.md`.

- [x] После согласования плана выполнить `pnpm check`, отметить `P11б.1` готовым и закоммитить этот план вместе с трекером отдельным коммитом `docs(plan): план английской версии`.
- [x] В спеке закрепить решения 1-5: URL, приоритет языка, два комплекта данных, общие отметки и раздельные песочницы, отдельные пути уроков, оригинал ошибки Postgres. Уточнить `5.1`, `5.10`, `5.11` и `6.6`; оставить пользовательские ссылки на старых маршрутах.
- [x] В контрактах описать `Locale = 'ru' | 'en'`; `loadDatasetSql(id, locale?)`; `Sandbox.loadLesson(id, journal, locale?)` и ключ снимка `(datasetId, locale)`; язык в `TraceOptions`, `AnimatorContext` и контексте объяснения ошибки; раздельное рабочее состояние по языкам; методы реестра с языком и новую папку уроков. Не менять форму результата SQL и `Stage.caption: string`. Необязательный язык в существующих API по умолчанию означает `ru`.
- [x] В `CLAUDE.md` заменить правило «Тексты интерфейса на русском» на правило двух языков; сохранить правило русских комментариев и остальные инварианты.
- [x] Сверить документ с решениями и `git diff --check`, выполнить `pnpm check`. Отметить `P11б.7` готовым и сделать отдельный коммит `docs(contracts): описать английскую версию` вместе с трекером.

## Task 2: Язык, маршруты, реестр и интерфейс

**Трекер:** `P11б.2`. **Файлы:** `src/lib/i18n.ts`, `src/lib/messages.ts`, `src/app/router.tsx`, `src/stores/settings.ts`, `src/features/shell/*`, `src/features/lessons/*`, `content/chapters.ts`, `plugins/lessons-meta.ts`, `src/virtual-modules.d.ts` и соответствующие тесты.

**Интерфейсы:** `resolveLocale(search: string, persisted: unknown): Locale`; `lessonHref(id: string, locale: Locale): string`; `getLesson(id: string, locale?: Locale): LessonMeta | undefined`; `loadLessonContent(meta: LessonMeta)`; `Locale` и словари доступны из чистых TS-модулей. `LessonMeta` получает `locale` и путь конкретной версии; `id` остаётся общим. `SettingsStore` получает `locale` и `setLocale` с безопасным чтением старой записи.

- [x] Добавить `tests/unit/i18n.test.ts` с тестом выбора языка:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { resolveLocale } from '@/lib/i18n';

  describe('язык ссылки и настроек', () => {
    it.each([
      ['?lang=en', 'ru', 'en'],
      ['?lang=ru', 'en', 'ru'],
      ['', 'en', 'en'],
      ['?lang=fr', 'en', 'en'],
      ['?lang=fr', 'bad', 'ru'],
      ['', undefined, 'ru'],
    ] as const)('%s + %s → %s', (search, saved, expected) => {
      expect(resolveLocale(search, saved)).toBe(expected);
    });
  });
  ```

  Добавить тесты корневого редиректа, сохранения других параметров при переключении, `html.lang`, истории и прямых старых ссылок. Для повторного `lang` брать первое значение; его неверное значение обрабатывается как отсутствие языка в URL.
- [x] Реализовать выбор и сохранение языка, нормализацию URL, переключатель с клавиатуры и читабельным доступным именем. При изменении URL обновлять настройку без цикла навигаций. Сохранить существующие настройки темы и панелей.
- [x] Расширить сборщик метаданных двумя корнями: одинаковый `id` в разных языках допустим, дубль в одном языке и несовпадение общих полей дают ошибку с путями. Русский каталог остаётся основным порядком уроков; отсутствующий английский файл явно обозначается как ожидающий перевода. До задачи 4 при отсутствии английского урока рабочая область отключена: переключение не должно перезаписать русские SQL или журнал. Кэш ленивых MDX-компонентов ключевать парой `locale` и `id` или полным путём. Навигацию, английский поиск и `ru → en → ru` проверить в unit/DOM-тестах на подготовленных метаданных, браузерный сценарий дополнить реальными переводами в задаче 7.
- [x] Вынести пользовательские строки оболочки, боковой панели, поиска, справки, настроек, MDX-компонентов, редактора, доски и результатов в словари. Проверить подписи кнопок, пустые и ошибочные состояния, `title`, `aria-label`, `aria-live`, сообщения screen reader и строки библиотечных компонентов. Пользовательские данные и исходную ошибку БД не менять.
- [x] Запустить `pnpm exec vitest run --project node tests/unit/i18n.test.ts plugins/lessons-meta.test.ts` и `pnpm exec vitest run --project dom src/features/shell/LanguageToggle.test.tsx src/features/lessons/registry.test.ts`, затем `pnpm check`, `pnpm build` и `pnpm exec playwright test tests/e2e/english.spec.ts --workers=1`. Отметить `P11б.2` и закоммитить.

## Task 3: Ошибки, подписи трассы и сцены

**Трекер:** `P11б.3`. **Файлы:** `src/features/errors/*`, `src/features/tracer/*`, `src/features/overlay/*`, `src/features/timeline/*`, `src/features/scenes/*`, `src/features/sessions/*`, `content/scenarios/*`, связанные тесты.

**Интерфейсы:** `TraceOptions.locale?: Locale`; `AnimatorContext.locale?: Locale`; `ErrorContext.locale?: Locale`; `scenarioForLocale(scenario: Scenario, locale: Locale): Scenario` в `content/scenarios/localize.ts`. При отсутствии параметра действует `ru`. Передавать язык во вложенные трассы и сценарии явно; не читать Zustand, DOM или настройки браузера из трассировщика. `Trace`, SQLSTATE и структура результатов не зависят от языка.

- [x] Добавить тесты английских и русских подписей для счётчиков 0, 1 и 2; обычного запроса, JOIN, вложенного CTE, DML, оконной функции, `final-only` и ошибок `42P01`, `42703`, `23505`, неизвестного SQLSTATE. Проверить сохранность `highlight`, предлагаемых исправлений и оригинального текста Postgres.
- [x] Передать язык в конструкторы подписей и причин `final-only`, включая вложенные трассы, `whitelist`, обработчики DDL/DML и сообщения в пробах. Использовать общие шаблоны с параметрами, не переводить готовые строки заменой фрагментов и не разбирать SQL-текст как перевод.
- [x] Перевести все фазы аниматоров, текстовые метки и счётчики на кадрах, пустое состояние доски, плеер и `aria-live`. При смене языка отменять устаревший расчёт и строить подписи для актуального языка; повторная трасса остаётся в `sandbox.preview` и не меняет БД.
- [x] В `content/scenarios/localize.ts` хранить английские `title`, `intro` и список переводов полей шагов `caption`, `note`, `settledNote` по `scenario.id`. `scenarioForLocale` возвращает новый сценарий с выбранным текстом; SQL, ожидания, порядок и блокировки не меняются. Тест проверяет все `id`, число шагов, наличие обязательных переводов и равенство рабочих полей обеих версий. Перевести подписи сцен MVCC, B-tree, нормализации, FTS, триггеров и партиций.
- [x] Запустить `pnpm exec vitest run --project node src/features/tracer/captions.test.ts src/features/errors/explain.test.ts src/features/overlay/playback.test.ts` и `pnpm exec vitest run --project dom src/features/timeline/Timeline.test.tsx src/features/sessions/TwoSessions.test.tsx`, затем `pnpm check` и `pnpm exec playwright test tests/e2e/english.spec.ts --workers=1`. До задачи 4 браузерная проверка касается оболочки; работающую английскую песочницу и подписи проверить после неё. Сценарии двух сессий проверить локально на PostgreSQL 18; зелёный CI job `sessions` остаётся обязательным при закрытии фазы в задаче 8. Отметить `P11б.3` и закоммитить.

## Task 4: Английские данные и сохранность песочниц

**Трекер:** `P11б.4`. **Файлы:** два новых SQL-файла, `src/features/db/{datasets,sandbox,useLessonSandbox}.ts`, `src/stores/lesson.ts`, `src/features/editor/EditorPane.tsx`, `src/features/board/BoardCanvas.tsx`, `tests/helpers/db.ts`, связанные тесты и `docs/datasets.md`.

**Интерфейсы:** `loadDatasetSql(id: DatasetId, locale?: Locale): Promise<string>`; `sandbox.loadLesson(id: DatasetId, journal: readonly string[], locale?: Locale): Promise<void>`; тестовый `withDataset<T>(id: DatasetId, fn: (db: DbClient) => Promise<T>, locale?: Locale): Promise<T>`. Снимки и базовые таблицы кэшируются по паре языка и датасета, включая кэш тестового `datasetDump`. В `LessonProgress` общие отметки остаются на уровне урока, а `journal`, `lastQuery`, `viewport` переносятся в `workspaces: Partial<Record<Locale, LessonWorkspace>>`. Версию `vs-lessons` поднять с 1 до 2 и перенести старые поля в `workspaces.ru` без потери остальных полей.

Сохранён вызов с массивом журнала. Для безопасного переключения во время выполняющейся команды `loadLesson` также принимает функцию чтения журнала, а `whenIdle` дожидается поставленных ранее команд.

- [x] Написать тесты на миграцию существующей записи с посещением, завершением, `readToEnd`, SQL, журналом и камерой; на независимость `ru` и `en`; на восстановление после перезагрузки. Проверить, что сбой загрузки или быстрое `ru → en → ru` не перезаписывает сохранённый журнал чужой версии.
- [x] Создать английские файлы данных по решению 2. Проверить на PGlite обе схемы, числа строк, первичные и внешние ключи, NULL, связи, ничьи и особые строки. Отдельно выполнить проверки `events`, `empty` и `big_bookstore`, включая его сжатый режим и повторную загрузку из снимка.
- [x] Добавить в `src/features/db/datasets.test.ts` проверку английской книги с `book_id = 10`: её название `Simple Python`, `author_id` и `category_id` равны NULL. На русском датасете тот же ключ, NULL и название `Простой Python`. Выполнить запросы к обоим датасетам через PGlite, а не искать литералы в SQL-файле.
- [x] Передать язык в загрузку датасета и кэш снимков, в том числе при восстановлении после сбоя, `undo` и `reset`. Первую английскую песочницу открыть с пустым журналом и английским `initialQuery`, не переигрывать русские команды на английских данных.
- [x] В `src/features/sessions/pg-runner.ts` добавить необязательный `locale` с умолчанием `ru` и передавать его в `loadDatasetSql('bookstore', locale)`. В `src/features/sessions/scenarios.pg.test.ts` прогнать каждый существующий сценарий отдельно на `ru` и `en` через настоящий PostgreSQL; в `sessions` CI должны выполняться оба набора.
- [x] Реализовать миграцию и переключение рабочих состояний: перед сменой сохранить текущий текст и журнал; после успешного открытия восстановить состояние выбранного языка. Учитывать запоздавшие результаты загрузки и превью, чтобы они не перезаписали актуальный язык. Показать у переключателя краткое объяснение отдельных песочниц.
- [x] Снять временную блокировку рабочей области из задачи 2. Если английский MDX ещё не переведён, для песочницы использовать технические поля русского урока `id`, `dataset` и `board`, не показывая его текст; начальный SQL оставить пустым. Проверить английские подписи и ошибки в браузере на вручную введённых запросах.
- [x] Описать соответствие особых строк в `docs/datasets.md`. Выполнить `pnpm exec vitest run --project node src/features/db/datasets.test.ts src/features/db/sandbox.test.ts`, `pnpm exec vitest run --project dom src/stores/lesson.test.ts src/features/db/useLessonSandbox.test.tsx` и `pnpm exec playwright test tests/e2e/english.spec.ts --workers=1`; затем `pnpm check` и `pnpm test:content`. Отметить `P11б.4` и закоммитить.

## Task 5: Гайд английского текста

**Трекер:** `P11б.5`. **Файлы:** `docs/content-style.md`, `docs/PROGRESS.md`.

- [x] Добавить в гайд английский раздел: обращение `you`, понятный разговорный английский, единые PostgreSQL-термины, подписи к особым строкам английского датасета, структура урока и перевод служебных заголовков. Требования к SQL, ссылкам, `expect`/`expectError`/`noexec`, `final-only` и ручному просмотру действуют для обоих языков. Уточнить, что кодовые идентификаторы и цитаты сообщений Postgres не переводятся.
- [x] Выполнить `git diff --check` и `pnpm check`; отметить `P11б.5` готовым и закоммитить гайд вместе с трекером.

## Task 6: Проверки переводов

**Трекер:** перед началом добавить и взять в работу `P11б.8` «Раннер контента для двух языков». **Файлы:** `tests/content/lessons.test.ts`, `tests/content/blocks.ts`, их тесты, `tests/helpers/db.ts`, `plugins/lessons-meta.ts`, его тесты, `docs/PROGRESS.md`.

До завершения переводов полную сверку можно запустить командой `VS_REQUIRE_EN_LESSONS=1 pnpm test:content`. В задаче 8 она станет обязательной без переменной окружения.

- [x] Расширить тесты контента: собирать и независимо компилировать все имеющиеся уроки обоих языков, запускать каждый набор SQL-блоков на своей версии датасета и проверять `trace`, ожидаемые ошибки и порядок применения блоков. Названия тестов включают `урок ru/<id>:` или `урок en/<id>:`. Проверить frontmatter, известные MDX-компоненты, ссылки на объекты и правила пути для обеих папок.
- [x] Проверить каждый имеющийся английский урок на пару с русским и совпадение общих полей; дубли и лишние `id` должны падать. До завершения перевода разрешить отсутствие пары, но не обходить проверку уже существующих английских файлов. Подготовить отдельный режим полной сверки всех пар; в задаче 8 включить его безусловно в `pnpm test:content`.
- [x] Проверить на временных тестовых данных, что испорченный английский SQL, отсутствующее ожидание и лишний или дублированный `id` приводят к падению, а один корректный перевод выполняется на английском датасете. Запустить `pnpm test:content` и `pnpm check`; отметить `P11б.8` и закоммитить раннер с трекером.

## Task 7: Перевод одного урока

Эту задачу повторять для каждого пункта списка ниже, строго по одному. Перед началом создать в Ф11б пункт трекера `L<номер>.en`, например `L0.1.en`, со статусом `⬜`, затем перевести его в `🔄` с датой. Общий пункт `P11б.6` остаётся `⬜`, пока переводятся отдельные уроки. Это сохраняет правило одного пункта `🔄` на агента.

- [ ] Прочитать русский урок, соответствующие страницы PostgreSQL и указанный им референс курса. Сохранить смысл, глубину, структуру, проверяемые тезисы и авторский текст; фразы курса не копировать.
- [ ] Создать английский MDX-файл из списка; перевести frontmatter для читателя, текст и все `caption`. Сверить названия и особые строки с `docs/datasets.md`. Адаптировать SQL-литералы, текстовые значения и псевдонимы так, чтобы пример объяснял тот же принцип на английских данных. Если в SQL-блоке появится поясняющий комментарий, перенести пояснение в английский текст рядом с блоком; служебные комментарии `final-only` оставить на русском. Идентификаторы учебной схемы оставить прежними.
- [ ] Выполнить каждый SQL-блок на английском датасете в порядке урока, пересчитать ожидаемые строки и ошибки по PGlite. Для FTS проверить фактические лексемы и конфигурацию Postgres; для `apply` проверить последствия и последующие блоки. Не переносить ожидание автоматически, если перевод изменяет сравнение или сортировку.
- [ ] Запустить `pnpm exec vitest run --project content tests/content/lessons.test.ts -t 'урок en/<id>:'`, затем `pnpm test:content`. Оба прогона должны пройти. Проверить глазами на доске каждый `run`/`apply` и каждую отдельную сцену; при `final-only` оставить причину и убедиться, что итог совпадает с текстом.
- [ ] Выполнить `pnpm check`; отметить `L<номер>.en` готовым с датой и коммитить урок вместе с трекером. Только после этого перейти к следующему уроку.

### Очерёдность английских уроков


**00-start**

- [x] 0.1 `how-to-use`: `content/lessons-en/00-start/01-how-to-use.mdx`

**01-basics**

- [x] 1.1 `table-anatomy`: `content/lessons-en/01-basics/01-table-anatomy.mdx`
- [x] 1.2 `cluster-db-schema`: `content/lessons-en/01-basics/02-cluster-db-schema.mdx`
- [x] 1.3 `primary-foreign-key`: `content/lessons-en/01-basics/03-primary-foreign-key.mdx`
- [x] 1.4 `command-groups`: `content/lessons-en/01-basics/04-command-groups.mdx`

**02-ddl**

- [x] 2.1 `create-schema`: `content/lessons-en/02-ddl/01-create-schema.mdx`
- [x] 2.2 `create-table`: `content/lessons-en/02-ddl/02-create-table.mdx`
- [x] 2.2a `generated-columns`: `content/lessons-en/02-ddl/03-generated-columns.mdx`
- [x] 2.3 `constraints`: `content/lessons-en/02-ddl/04-constraints.mdx`
- [x] 2.4 `fk-on-delete`: `content/lessons-en/02-ddl/05-fk-on-delete.mdx`
- [x] 2.5 `identity-sequences`: `content/lessons-en/02-ddl/06-identity-sequences.mdx`
- [x] 2.6 `alter-table`: `content/lessons-en/02-ddl/07-alter-table.mdx`
- [x] 2.7 `drop-truncate`: `content/lessons-en/02-ddl/08-drop-truncate.mdx`
- [x] 2.8 `comment-on`: `content/lessons-en/02-ddl/09-comment-on.mdx`

**03-dml**

- [x] 3.1 `insert`: `content/lessons-en/03-dml/01-insert.mdx`
- [x] 3.2 `returning`: `content/lessons-en/03-dml/02-returning.mdx`
- [x] 3.3 `update`: `content/lessons-en/03-dml/03-update.mdx`
- [x] 3.4 `delete`: `content/lessons-en/03-dml/04-delete.mdx`
- [x] 3.5 `upsert`: `content/lessons-en/03-dml/05-upsert.mdx`
- [x] 3.6 `merge`: `content/lessons-en/03-dml/06-merge.mdx`

**04-select**

- [x] 4.1 `select-basics`: `content/lessons-en/04-select/01-select-basics.mdx`
- [x] 4.2 `logical-order`: `content/lessons-en/04-select/02-logical-order.mdx`
- [x] 4.3 `where-boolean`: `content/lessons-en/04-select/03-where-boolean.mdx`
- [x] 4.4 `operators`: `content/lessons-en/04-select/04-operators.mdx`
- [x] 4.5 `null-logic`: `content/lessons-en/04-select/05-null-logic.mdx`
- [x] 4.6 `order-by`: `content/lessons-en/04-select/06-order-by.mdx`
- [x] 4.7 `limit-offset`: `content/lessons-en/04-select/07-limit-offset.mdx`
- [x] 4.8 `distinct-on`: `content/lessons-en/04-select/08-distinct-on.mdx`
- [ ] 4.9 `case-when`: `content/lessons-en/04-select/09-case-when.mdx`
- [ ] 4.10 `values-generate-series`: `content/lessons-en/04-select/10-values-generate-series.mdx`

**05-types**

- [ ] 5.1 `types-casting`: `content/lessons-en/05-types/01-types-casting.mdx`
- [ ] 5.2 `numbers`: `content/lessons-en/05-types/02-numbers.mdx`
- [ ] 5.3 `strings`: `content/lessons-en/05-types/03-strings.mdx`
- [ ] 5.4 `dates-time`: `content/lessons-en/05-types/04-dates-time.mdx`
- [ ] 5.5 `boolean`: `content/lessons-en/05-types/05-boolean.mdx`
- [ ] 5.6 `enum`: `content/lessons-en/05-types/06-enum.mdx`
- [ ] 5.7 `arrays`: `content/lessons-en/05-types/07-arrays.mdx`
- [ ] 5.8 `jsonb`: `content/lessons-en/05-types/08-jsonb.mdx`
- [ ] 5.9 `uuid-pk`: `content/lessons-en/05-types/09-uuid-pk.mdx`

**06-joins**

- [ ] 6.1 `relations`: `content/lessons-en/06-joins/01-relations.mdx`
- [ ] 6.2 `inner-join`: `content/lessons-en/06-joins/02-inner-join.mdx`
- [ ] 6.3 `left-right-join`: `content/lessons-en/06-joins/03-left-right-join.mdx`
- [ ] 6.4 `full-join`: `content/lessons-en/06-joins/04-full-join.mdx`
- [ ] 6.5 `cross-join`: `content/lessons-en/06-joins/05-cross-join.mdx`
- [ ] 6.6 `self-join`: `content/lessons-en/06-joins/06-self-join.mdx`
- [ ] 6.7 `multi-join`: `content/lessons-en/06-joins/07-multi-join.mdx`
- [ ] 6.8 `natural-join`: `content/lessons-en/06-joins/08-natural-join.mdx`
- [ ] 6.9 `on-vs-where`: `content/lessons-en/06-joins/09-on-vs-where.mdx`
- [ ] 6.10 `semi-join`: `content/lessons-en/06-joins/10-semi-join.mdx`
- [ ] 6.11 `anti-join`: `content/lessons-en/06-joins/11-anti-join.mdx`
- [ ] 6.12 `row-multiplication`: `content/lessons-en/06-joins/12-row-multiplication.mdx`
- [ ] 6.13 `lateral-join`: `content/lessons-en/06-joins/13-lateral-join.mdx`

**07-aggregation**

- [ ] 7.1 `aggregate-functions`: `content/lessons-en/07-aggregation/01-aggregate-functions.mdx`
- [ ] 7.2 `group-by`: `content/lessons-en/07-aggregation/02-group-by.mdx`
- [ ] 7.3 `having`: `content/lessons-en/07-aggregation/03-having.mdx`
- [ ] 7.4 `filter-aggregates`: `content/lessons-en/07-aggregation/04-filter-aggregates.mdx`
- [ ] 7.5 `rollup-cube`: `content/lessons-en/07-aggregation/05-rollup-cube.mdx`

**08-subqueries**

- [ ] 8.1 `scalar-subquery`: `content/lessons-en/08-subqueries/01-scalar-subquery.mdx`
- [ ] 8.2 `from-subquery`: `content/lessons-en/08-subqueries/02-from-subquery.mdx`
- [ ] 8.3 `correlated-subquery`: `content/lessons-en/08-subqueries/03-correlated-subquery.mdx`
- [ ] 8.4 `in-exists-any-all`: `content/lessons-en/08-subqueries/04-in-exists-any-all.mdx`
- [ ] 8.5 `set-operations`: `content/lessons-en/08-subqueries/05-set-operations.mdx`
- [ ] 8.6 `cte`: `content/lessons-en/08-subqueries/06-cte.mdx`
- [ ] 8.7 `recursive-cte`: `content/lessons-en/08-subqueries/07-recursive-cte.mdx`
- [ ] 8.8 `cte-materialization`: `content/lessons-en/08-subqueries/08-cte-materialization.mdx`

**09-windows**

- [ ] 9.1 `over-partition`: `content/lessons-en/09-windows/01-over-partition.mdx`
- [ ] 9.2 `ranking`: `content/lessons-en/09-windows/02-ranking.mdx`
- [ ] 9.3 `lag-lead`: `content/lessons-en/09-windows/03-lag-lead.mdx`
- [ ] 9.4 `window-frame`: `content/lessons-en/09-windows/04-window-frame.mdx`
- [ ] 9.5 `top-n`: `content/lessons-en/09-windows/05-top-n.mdx`

**10-views**

- [ ] 10.1 `view`: `content/lessons-en/10-views/01-view.mdx`
- [ ] 10.2 `materialized-view`: `content/lessons-en/10-views/02-materialized-view.mdx`

**11-transactions**

- [ ] 11.1 `transactions`: `content/lessons-en/11-transactions/01-transactions.mdx`
- [ ] 11.2 `savepoint`: `content/lessons-en/11-transactions/02-savepoint.mdx`
- [ ] 11.3 `mvcc`: `content/lessons-en/11-transactions/03-mvcc.mdx`
- [ ] 11.4 `isolation`: `content/lessons-en/11-transactions/04-isolation.mdx`
- [ ] 11.5 `locks`: `content/lessons-en/11-transactions/05-locks.mdx`

**12-indexes**

- [ ] 12.1 `btree-seq-vs-index`: `content/lessons-en/12-indexes/01-btree-seq-vs-index.mdx`
- [ ] 12.2 `explain`: `content/lessons-en/12-indexes/02-explain.mdx`
- [ ] 12.3 `composite-indexes`: `content/lessons-en/12-indexes/03-composite-indexes.mdx`
- [ ] 12.4 `index-variants`: `content/lessons-en/12-indexes/04-index-variants.mdx`
- [ ] 12.5 `selectivity`: `content/lessons-en/12-indexes/05-selectivity.mdx`
- [ ] 12.6 `index-types`: `content/lessons-en/12-indexes/06-index-types.mdx`
- [ ] 12.7 `index-maintenance`: `content/lessons-en/12-indexes/07-index-maintenance.mdx`

**13-design**

- [ ] 13.1 `normalization`: `content/lessons-en/13-design/01-normalization.mdx`
- [ ] 13.2 `denormalization`: `content/lessons-en/13-design/02-denormalization.mdx`
- [ ] 13.3 `dont-do-this`: `content/lessons-en/13-design/03-dont-do-this.mdx`

**14-extras**

- [ ] 14.1 `full-text-search`: `content/lessons-en/14-extras/01-full-text-search.mdx`
- [ ] 14.2 `functions`: `content/lessons-en/14-extras/02-functions.mdx`
- [ ] 14.3 `triggers`: `content/lessons-en/14-extras/03-triggers.mdx`
- [ ] 14.4 `roles`: `content/lessons-en/14-extras/04-roles.mdx`
- [ ] 14.5 `partitioning`: `content/lessons-en/14-extras/05-partitioning.mdx`
- [ ] 14.6 `sizes-catalogs`: `content/lessons-en/14-extras/06-sizes-catalogs.mdx`

## Task 8: Сквозная проверка и закрытие фазы

**Трекер:** после завершения всех `L*.en` перевести `P11б.6` в `🔄`. **Файлы:** `tests/content/lessons.test.ts`, `tests/e2e/english.spec.ts`, тесты сцен и `.github/workflows/ci.yml`, если команда проверки контента не запущена в CI; `docs/PROGRESS.md`.

- [ ] Сделать полное соответствие набора `id` русских и английских уроков обязательным в обычном `pnpm test:content`. Проверить, что удаление или переименование любого английского файла ломает тест, а после восстановления тест проходит. Проверить, что CI запускает эту команду без разрешения неполного набора.
- [ ] Проверить в `tests/e2e/english.spec.ts`: первый вход, сохранённый язык и прямые ссылки; поиск, предыдущий и следующий урок; смену языка и историю; применение, сброс и возврат к обоим журналам; SELECT, JOIN, DML и ошибку с оригинальным сообщением; доступные подписи, клавиатуру и `html[lang]`. Убедиться, что после перезагрузки язык и рабочие данные восстанавливаются.
- [ ] Дополнить браузерные проверки сценариями Ф11: два сеанса с ожиданием блокировки, MVCC, B-tree и `EXPLAIN`, нормализация и FTS, триггер и партиционирование. Проверить текст и поведение на английском; русские сценарии должны по-прежнему проходить.
- [ ] Последовательно выполнить `pnpm check`, `pnpm test:content`, `pnpm build`, `pnpm e2e --workers=1`. Убедиться в зелёном результате CI job `sessions`, где сценарии проверяются на настоящем PostgreSQL 18. Ожидается успешный выход каждой команды и отсутствие пропущенной проверки двух сессий в CI.
- [ ] Проверить по трекеру, что все уроки `L*.en` и пункты `P11б.1`-`P11б.5` и `P11б.7`-`P11б.8` закрыты, а пары из реестра совпадают. Поставить `P11б.6` и сводку Ф11б в `✅` с датой; закоммитить итог и трекер вместе.
