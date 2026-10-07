-- Датасет bookstore: книжный магазин.
-- Маленькие таблицы, чтобы каждую строку было видно на доске.
-- Особые строки (на них опираются уроки) описаны в docs/datasets.md и в комментариях ниже.

create type order_status as enum ('new', 'paid', 'shipped', 'cancelled');

create table author (
  author_id bigint generated always as identity primary key,
  name text not null,
  country text,
  born_year int
);

insert into author (name, country, born_year) values
  ('Михаил Шолохов', 'Россия', 1905),
  ('Лусиану Рамальо', 'Бразилия', 1964),
  ('Александр Пушкин', 'Россия', 1799),
  ('Александр Беляев', 'Россия', 1884),
  ('Жюль Верн', 'Франция', 1828),
  ('Борис Пастернак', 'Россия', 1890);   -- особый: автор без книг

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
  ('Литература по фотографии', null),   -- особая: категория без книг
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

insert into book (title, author_id, category_id, price, pages, published_at, tags, meta) values
  ('Тихий Дон', 1, 4, 890.00, 1504, '1940-01-01', '{классика,роман}', '{"lang": "ru", "format": "hardcover"}'),
  ('Python. К вершинам мастерства', 2, 6, 2400.00, 898, '2022-03-01', '{python,advanced}', '{"lang": "ru", "format": "paperback", "edition": 2}'),
  ('Судьба человека', 1, 4, 350.00, 64, '1957-01-01', '{классика,рассказ}', '{"lang": "ru"}'),
  ('Капитанская дочка', 3, 4, 420.00, 224, '1836-01-01', '{классика,роман}', null),
  ('Сказка о рыбаке и рыбке', 3, 4, 350.00, 32, '1835-01-01', '{классика,сказка,детям}', '{"lang": "ru", "illustrated": true}'),  -- ничья по цене с «Судьбой человека»
  ('Голова профессора Доуэля', 4, 3, 560.00, 256, '1925-01-01', '{фантастика}', null),
  ('Остров погибших кораблей', 4, 3, null, 192, '1926-01-01', '{фантастика,приключения}', null),  -- особая: без цены, ни разу не заказана
  ('Путешествие к центру Земли', 5, 3, 610.00, 320, '1864-01-01', '{фантастика,приключения}', '{"lang": "ru", "translated_from": "fr"}'),
  ('Дети капитана Гранта', 5, 3, 610.00, 704, '1868-01-01', '{приключения}', '{"lang": "ru", "translated_from": "fr"}'),  -- ничья по цене с «Путешествием»
  ('Простой Python', null, null, 1990.00, 592, '2021-06-01', '{python,beginner}', '{"lang": "ru"}'),  -- особая: без автора и без категории
  ('Изучаем Python', null, 6, 3200.00, 1648, '2020-01-01', '{python,beginner}', null);  -- особая: без автора, но с категорией

create table customer (
  customer_id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,
  city text,
  bonus int not null default 0 check (bonus >= 0),
  settings jsonb not null default '{}',
  created_at timestamptz not null
);

insert into customer (name, email, city, bonus, settings, created_at) values
  ('Анна Смирнова', 'anna@example.com', 'Москва', 120, '{"notify": true, "lang": "ru"}', '2024-01-15 10:00:00+03'),
  ('Иван Петров', 'ivan@example.com', 'Казань', 0, '{"notify": false}', '2024-02-01 12:30:00+03'),
  ('Мария Иванова', 'maria@example.com', null, 50, '{"notify": true}', '2024-02-20 09:15:00+03'),  -- особая: без города
  ('Олег Смирнов', 'oleg@example.com', 'Москва', 0, '{}', '2024-03-05 18:45:00+03'),
  ('Иван Петров', 'ivan.petrov@example.com', 'Санкт-Петербург', 30, '{"notify": true, "lang": "en"}', '2024-04-10 14:00:00+03'),  -- особый: полный тёзка покупателя 2
  ('Елена Козлова', 'elena@example.com', 'Казань', 0, '{"lang": "ru"}', '2024-05-01 08:00:00+03');  -- особая: без заказов и отзывов

create table orders (
  order_id bigint generated always as identity primary key,
  customer_id bigint not null references customer (customer_id),
  status order_status not null default 'new',
  created_at timestamptz not null
);

insert into orders (customer_id, status, created_at) values
  (1, 'paid', '2024-03-01 10:00:00+03'),
  (1, 'shipped', '2024-03-15 19:30:00+03'),
  (2, 'paid', '2024-03-20 11:00:00+03'),
  (3, 'cancelled', '2024-04-02 23:50:00+03'),
  (4, 'new', '2024-04-05 09:00:00+03'),
  (5, 'paid', '2024-04-10 15:00:00+03'),
  (1, 'paid', '2024-05-01 00:10:00+03'),  -- особый: по Москве 1 мая, по UTC ещё 30 апреля
  (5, 'new', '2024-05-03 12:00:00+03');

create table order_item (
  order_id bigint not null references orders (order_id) on delete cascade,
  book_id bigint not null references book (book_id),
  qty int not null check (qty > 0),
  price numeric(10, 2) not null,
  primary key (order_id, book_id)
);

insert into order_item (order_id, book_id, qty, price) values
  (1, 1, 1, 890.00), (1, 4, 2, 420.00),
  (2, 2, 1, 2400.00),
  (3, 8, 1, 610.00), (3, 9, 1, 610.00), (3, 6, 1, 560.00),
  (4, 10, 1, 1990.00),
  (5, 3, 3, 350.00), (5, 5, 1, 350.00),
  (6, 2, 1, 2400.00), (6, 10, 1, 1990.00),
  (7, 1, 1, 890.00), (7, 8, 2, 610.00),
  (8, 4, 1, 420.00), (8, 11, 1, 3200.00);

create table employee (
  employee_id int generated always as identity primary key,
  name text not null,
  manager_id int references employee (employee_id),
  position text not null,
  salary numeric(10, 2) not null,
  hired_at date not null
);

insert into employee (name, manager_id, position, salary, hired_at) values
  ('Ольга Николаева', null, 'Директор', 300000, '2019-01-10'),  -- особая: корень дерева, manager_id = NULL
  ('Павел Орлов', 1, 'Руководитель продаж', 180000, '2019-06-01'),
  ('Светлана Волкова', 1, 'Руководитель склада', 160000, '2020-02-15'),
  ('Дмитрий Соколов', 2, 'Менеджер', 90000, '2021-03-01'),
  ('Алексей Морозов', 2, 'Менеджер', 190000, '2022-01-10'),  -- особый: зарабатывает больше своего руководителя
  ('Наталья Лебедева', 3, 'Кладовщик', 70000, '2021-09-01'),
  ('Игорь Новиков', 3, 'Кладовщик', 70000, '2023-04-01'),  -- ничья по зарплате с Лебедевой
  ('Татьяна Зайцева', 4, 'Стажёр', 40000, '2024-07-01');  -- четвёртый уровень дерева

create table review (
  review_id bigint generated always as identity primary key,
  book_id bigint not null references book (book_id),
  customer_id bigint not null references customer (customer_id),
  rating int not null check (rating between 1 and 5),
  body text not null,
  created_at timestamptz not null
);

insert into review (book_id, customer_id, rating, body, created_at) values
  (1, 1, 5, 'Великий роман о донском казачестве. Читается на одном дыхании.', '2024-03-10 20:00:00+03'),
  (2, 1, 5, 'Лучшая книга по Python для тех, кто уже пишет код.', '2024-03-25 21:00:00+03'),
  (2, 5, 4, 'Глубоко, но местами тяжело. Python раскрыт отлично.', '2024-04-20 18:00:00+03'),
  (8, 2, 4, 'Захватывающее путешествие, отличная фантастика.', '2024-03-28 19:00:00+03'),
  (9, 2, 3, 'Длинновато, но приключения хорошие.', '2024-03-29 19:30:00+03'),
  (3, 4, 5, 'Короткий и очень сильный рассказ.', '2024-04-15 22:00:00+03'),
  (10, 3, 2, 'Слишком простая книга, ожидала большего.', '2024-04-05 13:00:00+03'),
  (10, 5, 4, 'Отличное введение в Python для новичков.', '2024-04-12 16:00:00+03'),
  (1, 5, 4, 'Тяжёлый, но великий роман.', '2024-05-05 17:00:00+03'),
  (6, 2, 5, 'Жуткая и увлекательная фантастика.', '2024-04-01 20:00:00+03');

analyze;
