import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

const TREE = `with recursive t as (
  select employee_id, name, manager_id from employee where manager_id is null
  union all
  select e.employee_id, e.name, e.manager_id
  from employee e join t on e.manager_id = t.employee_id
)
select * from t`;

describe('стадия recursion', () => {
  it('дерево сотрудников идёт слоями до пустой итерации', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, TREE);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const recursion = stageOf(trace, 'recursion');
        expect(recursion.name).toBe('t');
        expect(recursion.iterations.map((item) => item.rows.length)).toEqual([1, 2, 4, 1, 0]);
        expect(recursion.output.rows).toHaveLength(8);
        expect(trace.result?.rows).toHaveLength(8);
      }),
    ));

  it('UNION схлопывает повтор и останавливается на пустой итерации', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'with recursive t(n) as (select 1 union select n + 1 from t where n < 3) select sum(n) from t',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        const recursion = stageOf(trace, 'recursion');
        expect(recursion.iterations.map((item) => item.rows.map((row) => row.values[0]))).toEqual([
          [1],
          [2],
          [3],
          [],
        ]);
        expect(trace.result?.rows).toEqual([[6]]);
      }),
    ));
});
