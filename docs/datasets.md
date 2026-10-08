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

## Другие датасеты

`empty`, `events`, `big_bookstore` (тип `DatasetId`) описываются здесь в той фазе, которая создаёт их файлы.
