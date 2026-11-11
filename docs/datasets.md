# Датасеты

Датасет = файл `content/datasets/<id>.sql`. Урок выбирает его полем `dataset` во frontmatter. Песочница один раз выполняет SQL датасета, снимает снапшот (`checkpoint` + `dumpDataDir`) и дальше поднимает урок из снапшота, повторяя журнал применённых операторов.

Правила:

- SQL датасета детерминирован: без `now()`, `random()` и без зависимости от часового пояса машины (у `timestamptz` всегда явное смещение `+03`).
- Особая строка помечается комментарием `-- особый: ...` в SQL и строкой в списке ниже.
- Поменял датасет → обнови этот файл и `src/features/db/datasets.test.ts`, прогони `pnpm test` и `pnpm test:content`: уроки опираются на эти числа.

## bookstore

Книжный магазин, главный датасет курса. Тип `order_status`: enum `('new', 'paid', 'shipped', 'cancelled')`. Все первичные ключи `generated always as identity`; после загрузки `last_value` каждой последовательности равен числу строк таблицы.

Таблицы:

- `author`, 6 строк: `author_id`, `name not null`, `country`, `born_year`.
- `book_category`, 6 строк: `category_id`, `name not null unique`, `parent_id → book_category`. Дерево: «Художественная литература» → «Фантастика», «Классика»; «Литература по программированию» → «Python»; «Литература по фотографии» без детей.
- `book`, 11 строк: `book_id`, `title not null`, `author_id → author` (NULL можно), `category_id → book_category` (NULL можно), `price numeric(10,2)` (NULL можно), `pages`, `published_at date`, `tags text[] not null default '{}'`, `meta jsonb`.
- `customer`, 6 строк: `customer_id`, `name not null`, `email not null unique`, `city`, `bonus int not null default 0 check (bonus >= 0)`, `settings jsonb not null default '{}'`, `created_at timestamptz not null`.
- `orders`, 8 строк: `order_id`, `customer_id → customer`, `status order_status not null default 'new'`, `created_at timestamptz not null`.
- `order_item`, 15 строк: первичный ключ `(order_id, book_id)`, `order_id → orders on delete cascade`, `book_id → book`, `qty check (qty > 0)`, `price numeric(10,2)`.
- `employee`, 8 строк: `employee_id`, `name`, `manager_id → employee`, `position`, `salary numeric(10,2)`, `hired_at date`.
- `review`, 10 строк: `review_id`, `book_id → book`, `customer_id → customer`, `rating check (rating between 1 and 5)`, `body`, `created_at timestamptz`.

Особые строки (на них опираются уроки):

- Автор без книг: Борис Пастернак (`author_id = 6`). LEFT JOIN, anti-join.
- Категория без книг вообще, даже в подкатегориях: «Литература по фотографии» (`category_id = 5`). У «Художественной литературы» (1) и «Литературы по программированию» (2) своих книг нет, книги только в подкатегориях. Рекурсивный CTE.
- Книга без цены и ни разу не заказанная: «Остров погибших кораблей» (`book_id = 7`). NULL в агрегатах и сортировке, anti-join.
- Книги без автора: «Простой Python» (10, ещё и без категории) и «Изучаем Python» (11, категория «Python»). INNER против LEFT и FULL JOIN.
- Ничьи по цене: 350.00 («Судьба человека» 3, «Сказка о рыбаке и рыбке» 5) и 610.00 («Путешествие к центру Земли» 8, «Дети капитана Гранта» 9). `rank`, `dense_rank`, `row_number`.
- Покупатель без заказов и отзывов: Елена Козлова (`customer_id = 6`).
- Покупатель без города: Мария Иванова (3).
- Полные тёзки: два «Иван Петров» (2 и 5) с разными email. GROUP BY по имени против GROUP BY по id.
- Заказ на границе суток: заказ 7 создан `2024-05-01 00:10+03`, по Москве это 1 мая, по UTC ещё 30 апреля. `timestamptz` и часовые пояса.
- Корень дерева сотрудников: Ольга Николаева (1), `manager_id` = NULL.
- Зарабатывает больше руководителя: Алексей Морозов (5), 190000 против 180000 у Павла Орлова (2). Self-join.
- Ничья по зарплате: Наталья Лебедева (6) и Игорь Новиков (7), по 70000.
- Самый глубокий уровень дерева: Татьяна Зайцева (8), четвёртый уровень.

## empty

Пустая база для уроков, где структуру строят с нуля. Только схема `public`, `search_path = public`, ни одной таблицы и последовательности. Всё, что появляется на доске, создал сам ученик.

Уроки: 2.1 (CREATE SCHEMA), 2.2 (CREATE TABLE), 2.2a (генерируемые колонки).

Особых строк нет. Номера identity начинаются с 1: таблицы создаются с нуля.

## events

События заказов для оконных функций. Загружается поверх `bookstore`: `loadDatasetSql('events')` сначала выполняет `bookstore.sql`, потом `events.sql`. В файле только таблица `event`, заказы берутся из базы.

`event`, 21 строка: `event_id`, `order_id → orders on delete cascade`, `kind` (`created`, `paid`, `shipped`, `cancelled`, `returned`), `amount numeric(10,2)`, `happened_at timestamptz`.

Событий по заказам: 1:3, 2:2, 3:3, 4:2, 5:3, 6:2, 7:4, 8:2. Платежей семь.

Особые строки:

- Заказ 3: `paid` и `cancelled` в одну секунду. Разница рамок `RANGE` и `ROWS`.
- Заказ 4: отменён без `paid`. Проверка «нет платежа».
- Заказ 7: `returned` позже `shipped`. Порядок событий и lead/lag.

## big_bookstore

Большой книжный магазин для уроков об индексах и планах запросов. Данные детерминированы; кроме первичных и уникальных ключей индексы создаются в уроках.

Таблицы: `book` и `orders` по 100 000 строк, `customer` 20 000, `author` 2 000, `book_category` 6. Таблиц `order_item`, `employee` и `review` нет.

Опорные значения:

- Заказы: 3 000 `new`, 67 000 `paid`, 25 000 `shipped`, 5 000 `cancelled`; у покупателя 42 пять заказов.
- За сутки 1 июня 2023 года по Москве создано 288 заказов. В запросах использовать явное смещение `+03`.
- В названиях 16 667 книг встречается `Python`, в 16 666 - «кошках»; тег `python` есть у 25 000 книг, `meta.lang = 'en'` - у 10 000.
- Email записаны в смешанном регистре, например `User42@Example.com`, для урока об индексе по выражению.
- Заказы `new` принадлежат 600 покупателям; частичный уникальный индекс по `customer_id` для них создать нельзя.
- `created_at` в заказах растёт вместе с `order_id`, что позволяет показать BRIN.

