import type { Scenario } from '@/features/sessions/types';

export const isolation: Scenario[] = [
  {
    id: 'non-repeatable-read',
    title: 'Read Committed',
    intro: 'Каждый SELECT получает новый снимок зафиксированных данных.',
    setup: '',
    steps: [
      { session: 'b', caption: 'Открывает транзакцию', sql: 'begin isolation level read committed' },
      {
        session: 'b',
        caption: 'Читает цену',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B видит 890,00.',
      },
      { session: 'a', caption: 'Открывает транзакцию', sql: 'begin' },
      { session: 'a', caption: 'Меняет цену', sql: 'update book set price = 1 where book_id = 1' },
      { session: 'a', caption: 'Фиксирует изменение', sql: 'commit', note: 'A зафиксировала цену 1,00.' },
      {
        session: 'b',
        caption: 'Повторяет чтение',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['1.00']] },
        note: 'B видит новую цену 1,00 в той же транзакции.',
      },
      { session: 'b', caption: 'Завершает транзакцию', sql: 'commit' },
    ],
  },
  {
    id: 'repeatable-read',
    title: 'Repeatable Read',
    intro: 'Повторное чтение использует прежний снимок, а конфликтующая запись вызывает ошибку.',
    setup: '',
    steps: [
      { session: 'b', caption: 'Открывает транзакцию', sql: 'begin isolation level repeatable read' },
      {
        session: 'b',
        caption: 'Читает цену',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B видит 890,00 в своём снимке.',
      },
      { session: 'a', caption: 'Открывает транзакцию', sql: 'begin' },
      { session: 'a', caption: 'Меняет цену', sql: 'update book set price = 1 where book_id = 1' },
      { session: 'a', caption: 'Фиксирует изменение', sql: 'commit', note: 'A зафиксировала цену 1,00.' },
      {
        session: 'b',
        caption: 'Читает прежний снимок',
        sql: 'select price::text from book where book_id = 1',
        expect: { rows: [['890.00']] },
        note: 'B по-прежнему видит 890,00.',
      },
      {
        session: 'b',
        caption: 'Пытается изменить ту же строку',
        sql: 'update book set price = 2 where book_id = 1',
        expectError: '40001',
        note: 'B получила ошибку сериализации 40001.',
      },
      {
        session: 'b',
        caption: 'Откатывает транзакцию',
        sql: 'rollback',
        note: 'B откатила транзакцию и может повторить её.',
      },
    ],
  },
];
