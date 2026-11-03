-- Датасет events: события заказов. Временные ряды для оконных функций.
-- Загружается поверх bookstore: таблицы заказов уже есть, здесь только event.
-- Особенности: у заказа 3 две строки с одинаковым happened_at (рамка RANGE vs ROWS),
-- у заказа 4 нет платежа (отменён), у заказа 7 возврат после доставки.

create table event (
  event_id bigint generated always as identity primary key,
  order_id bigint not null references orders (order_id) on delete cascade,
  kind text not null check (kind in ('created', 'paid', 'shipped', 'cancelled', 'returned')),
  amount numeric(10, 2),
  happened_at timestamptz not null
);

insert into event (order_id, kind, amount, happened_at) values
  (1, 'created',   null,    '2024-03-01 10:00:00+03'),
  (1, 'paid',      1730.00, '2024-03-01 10:05:00+03'),
  (1, 'shipped',   null,    '2024-03-16 09:00:00+03'),
  (2, 'created',   null,    '2024-03-20 11:00:00+03'),
  (2, 'paid',      2400.00, '2024-03-20 11:02:00+03'),
  (3, 'created',   null,    '2024-04-02 23:50:00+03'),
  (3, 'paid',      1780.00, '2024-04-02 23:55:00+03'),
  (3, 'cancelled', null,    '2024-04-02 23:55:00+03'),  -- особый: та же секунда, что платёж (RANGE vs ROWS)
  (4, 'created',   null,    '2024-04-05 09:00:00+03'),
  (4, 'cancelled', null,    '2024-04-05 10:00:00+03'),  -- особый: заказ без paid
  (5, 'created',   null,    '2024-04-10 15:00:00+03'),
  (5, 'paid',      1400.00, '2024-04-10 15:01:00+03'),
  (5, 'shipped',   null,    '2024-04-12 12:00:00+03'),
  (6, 'created',   null,    '2024-05-01 00:10:00+03'),
  (6, 'paid',      4390.00, '2024-05-01 00:12:00+03'),
  (7, 'created',   null,    '2024-05-03 11:00:00+03'),
  (7, 'paid',      2110.00, '2024-05-03 11:01:00+03'),
  (7, 'shipped',   null,    '2024-05-04 10:00:00+03'),
  (7, 'returned',  null,    '2024-05-06 18:00:00+03'),  -- особый: возврат после доставки
  (8, 'created',   null,    '2024-05-03 12:00:00+03'),
  (8, 'paid',      3620.00, '2024-05-03 12:03:00+03');

analyze;
