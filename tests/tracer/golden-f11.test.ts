import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';

const queries = [
  {
    sql: 'select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5',
    stages: 'scan:11 > expand:21 > filter:3 > project:3',
  },
  {
    sql: 'select c.customer_id, s.key, s.value from customer c, jsonb_each(c.settings) as s(key, value) where c.customer_id = 1',
    stages: 'scan:6 > expand:7 > filter:2 > project:2',
  },
  {
    sql: 'select u.tag, count(*) from book b, unnest(b.tags) as u(tag) group by u.tag order by u.tag',
    stages: 'scan:11 > expand:21 > group:10 > project:10 > sort:10',
  },
  {
    sql: 'with chosen as (select book_id, tags from book where book_id = 5) select c.book_id, u.tag from chosen c, unnest(c.tags) as u(tag)',
    stages: 'materialize:1 > scan:1 > expand:3 > project:3',
  },
  {
    sql: "select e.elem from (values ('[1,2,3]'::jsonb)) as j (doc), jsonb_array_elements(j.doc) as e (elem)",
    stages: 'materialize:1 > scan:1 > expand:3 > project:3',
  },
];

describe('golden Ф11: раскрытие массивов и JSON', () => {
  it.each(queries)('$sql', ({ sql, stages }) =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(stages);
      }),
    ),
  );
});
