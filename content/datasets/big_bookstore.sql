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
