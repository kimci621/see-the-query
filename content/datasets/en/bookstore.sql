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
  ('Mikhail Sholokhov', 'Russia', 1905),
  ('Luciano Ramalho', 'Brazil', 1964),
  ('Alexander Pushkin', 'Russia', 1799),
  ('Alexander Belyaev', 'Russia', 1884),
  ('Jules Verne', 'France', 1828),
  ('Boris Pasternak', 'Russia', 1890);   -- особый: автор без книг

create table book_category (
  category_id int generated always as identity primary key,
  name text not null unique,
  parent_id int references book_category (category_id)
);

insert into book_category (name, parent_id) values
  ('Fiction', null),
  ('Programming', null),
  ('Science fiction', 1),
  ('Classics', 1),
  ('Photography', null),   -- особая: категория без книг
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
  ('And Quiet Flows the Don', 1, 4, 890.00, 1504, '1940-01-01', '{classic,novel}', '{"lang": "ru", "format": "hardcover"}'),
  ('Fluent Python', 2, 6, 2400.00, 898, '2022-03-01', '{python,advanced}', '{"lang": "ru", "format": "paperback", "edition": 2}'),
  ('The Fate of a Man', 1, 4, 350.00, 64, '1957-01-01', '{classic,short_story}', '{"lang": "ru"}'),
  ('The Captain''s Daughter', 3, 4, 420.00, 224, '1836-01-01', '{classic,novel}', null),
  ('The Tale of the Fisherman and the Fish', 3, 4, 350.00, 32, '1835-01-01', '{classic,fairy_tale,children}', '{"lang": "ru", "illustrated": true}'),  -- ничья по цене с «Судьбой человека»
  ('Professor Dowell''s Head', 4, 3, 560.00, 256, '1925-01-01', '{science_fiction}', null),
  ('The Island of Lost Ships', 4, 3, null, 192, '1926-01-01', '{science_fiction,adventure}', null),  -- особая: без цены, ни разу не заказана
  ('Journey to the Center of the Earth', 5, 3, 610.00, 320, '1864-01-01', '{science_fiction,adventure}', '{"lang": "ru", "translated_from": "fr"}'),
  ('Captain Grant''s Children', 5, 3, 610.00, 704, '1868-01-01', '{adventure}', '{"lang": "ru", "translated_from": "fr"}'),  -- ничья по цене с «Путешествием»
  ('Simple Python', null, null, 1990.00, 592, '2021-06-01', '{python,beginner}', '{"lang": "ru"}'),  -- особая: без автора и без категории
  ('Learning Python', null, 6, 3200.00, 1648, '2020-01-01', '{python,beginner}', null);  -- особая: без автора, но с категорией

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
  ('Anna Smirnova', 'anna@example.com', 'Moscow', 120, '{"notify": true, "lang": "ru"}', '2024-01-15 10:00:00+03'),
  ('Ivan Petrov', 'ivan@example.com', 'Kazan', 0, '{"notify": false}', '2024-02-01 12:30:00+03'),
  ('Maria Ivanova', 'maria@example.com', null, 50, '{"notify": true}', '2024-02-20 09:15:00+03'),  -- особая: без города
  ('Oleg Smirnov', 'oleg@example.com', 'Moscow', 0, '{}', '2024-03-05 18:45:00+03'),
  ('Ivan Petrov', 'ivan.petrov@example.com', 'Saint Petersburg', 30, '{"notify": true, "lang": "en"}', '2024-04-10 14:00:00+03'),  -- особый: полный тёзка покупателя 2
  ('Elena Kozlova', 'elena@example.com', 'Kazan', 0, '{"lang": "ru"}', '2024-05-01 08:00:00+03');  -- особая: без заказов и отзывов

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
  ('Olga Nikolaeva', null, 'Director', 300000, '2019-01-10'),  -- особая: корень дерева, manager_id = NULL
  ('Pavel Orlov', 1, 'Sales Manager', 180000, '2019-06-01'),
  ('Svetlana Volkova', 1, 'Warehouse Manager', 160000, '2020-02-15'),
  ('Dmitry Sokolov', 2, 'Manager', 90000, '2021-03-01'),
  ('Alexey Morozov', 2, 'Manager', 190000, '2022-01-10'),  -- особый: зарабатывает больше своего руководителя
  ('Natalia Lebedeva', 3, 'Warehouse Assistant', 70000, '2021-09-01'),
  ('Igor Novikov', 3, 'Warehouse Assistant', 70000, '2023-04-01'),  -- ничья по зарплате с Лебедевой
  ('Tatiana Zaitseva', 4, 'Intern', 40000, '2024-07-01');  -- четвёртый уровень дерева

create table review (
  review_id bigint generated always as identity primary key,
  book_id bigint not null references book (book_id),
  customer_id bigint not null references customer (customer_id),
  rating int not null check (rating between 1 and 5),
  body text not null,
  created_at timestamptz not null
);

insert into review (book_id, customer_id, rating, body, created_at) values
  (1, 1, 5, 'A great novel about the Don Cossacks. Hard to put down.', '2024-03-10 20:00:00+03'),
  (2, 1, 5, 'The best Python book for people who already code.', '2024-03-25 21:00:00+03'),
  (2, 5, 4, 'In-depth and challenging at times. Explains Python well.', '2024-04-20 18:00:00+03'),
  (8, 2, 4, 'A gripping journey and great science fiction.', '2024-03-28 19:00:00+03'),
  (9, 2, 3, 'A little long, but the adventure is good.', '2024-03-29 19:30:00+03'),
  (3, 4, 5, 'A short and powerful story.', '2024-04-15 22:00:00+03'),
  (10, 3, 2, 'Too simple. I expected more.', '2024-04-05 13:00:00+03'),
  (10, 5, 4, 'A great introduction to Python for beginners.', '2024-04-12 16:00:00+03'),
  (1, 5, 4, 'A demanding but great novel.', '2024-05-05 17:00:00+03'),
  (6, 2, 5, 'Creepy and compelling science fiction.', '2024-04-01 20:00:00+03');

analyze;
