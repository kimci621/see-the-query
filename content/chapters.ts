export interface Chapter {
  id: string;
  number: number;
  title: string;
}

// Главы программы (спека, раздел 6.3). id используется во frontmatter уроков
export const CHAPTERS: Chapter[] = [
  { id: 'start', number: 0, title: 'Старт' },
  { id: 'basics', number: 1, title: 'Основы' },
  { id: 'ddl', number: 2, title: 'Структура (DDL)' },
  { id: 'dml', number: 3, title: 'Изменение данных (DML)' },
  { id: 'select', number: 4, title: 'Выборка из одной таблицы' },
  { id: 'types', number: 5, title: 'Типы данных и функции' },
  { id: 'joins', number: 6, title: 'Соединения' },
  { id: 'aggregation', number: 7, title: 'Агрегация' },
  { id: 'subqueries', number: 8, title: 'Подзапросы, множества, CTE' },
  { id: 'windows', number: 9, title: 'Оконные функции' },
  { id: 'views', number: 10, title: 'Представления' },
  { id: 'transactions', number: 11, title: 'Транзакции и конкурентность' },
  { id: 'indexes', number: 12, title: 'Индексы и производительность' },
  { id: 'design', number: 13, title: 'Проектирование' },
  { id: 'extras', number: 14, title: 'Сверху рутины' },
];
