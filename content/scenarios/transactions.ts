import type { Scenario } from '@/features/sessions/types';

export const transactions: Scenario[] = [
  {
    id: 'tx-basic',
    title: 'Фиксация транзакции',
    intro: 'Сессия B читает цену до и после фиксации изменения в сессии A.',
    setup: '',
    steps: [
      { session: 'a', caption: 'Начинает транзакцию', sql: 'begin' },
      {
        session: 'a',
        caption: 'Меняет цену книги 1',
        sql: 'update book set price = 1 where book_id = 1 returning price::text',
        expect: { rows: [['1.00']] },
        note: 'A видит новую цену 1,00.',
      },
      {
        session: 'b',
        caption: 'Читает цену до фиксации',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B видит прежнюю цену 890,00.',
      },
      { session: 'a', caption: 'Фиксирует изменение', sql: 'commit' },
      {
        session: 'b',
        caption: 'Читает цену снова',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['1.00']] },
        note: 'B видит зафиксированную цену 1,00.',
      },
    ],
  },
  {
    id: 'tx-rollback',
    title: 'Отмена транзакции',
    intro: 'Изменение в A отменяется и не попадает в чтение B.',
    setup: '',
    steps: [
      { session: 'a', caption: 'Начинает транзакцию', sql: 'begin' },
      {
        session: 'a',
        caption: 'Временно меняет цену',
        sql: 'update book set price = 1 where book_id = 1 returning price::text',
        expect: { rows: [['1.00']] },
        note: 'A видит временную цену 1,00.',
      },
      {
        session: 'b',
        caption: 'Читает цену до отмены',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B видит прежнюю цену 890,00.',
      },
      { session: 'a', caption: 'Отменяет изменение', sql: 'rollback', note: 'A отменила изменение.' },
      {
        session: 'b',
        caption: 'Читает цену снова',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B по-прежнему видит 890,00.',
      },
    ],
  },
  {
    id: 'savepoint',
    title: 'Ошибка и SAVEPOINT',
    intro: 'Откат к точке сохранения позволяет продолжить транзакцию после ошибки.',
    setup: '',
    steps: [
      { session: 'a', caption: 'Начинает транзакцию', sql: 'begin' },
      { session: 'a', caption: 'Создаёт точку сохранения', sql: 'savepoint s1' },
      {
        session: 'a',
        caption: 'Пытается сделать бонус отрицательным',
        sql: 'update customer set bonus = bonus - 500 where customer_id = 2',
        expectError: '23514',
        note: 'Ограничение CHECK отклонило изменение.',
      },
      {
        session: 'a',
        caption: 'Откатывается к точке сохранения',
        sql: 'rollback to savepoint s1',
        note: 'A может продолжить транзакцию.',
      },
      {
        session: 'a',
        caption: 'Считает покупателей',
        sql: 'select count(*)::text from customer',
        expect: { rows: [['6']] },
        note: 'A видит 6 покупателей.',
      },
      { session: 'a', caption: 'Завершает транзакцию', sql: 'commit' },
    ],
  },
];
