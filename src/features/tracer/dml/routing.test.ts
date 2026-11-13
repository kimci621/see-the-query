import { describe, expect, it } from 'vitest';
import { introspect } from '@/features/db/introspect';
import { inPreview, withDataset } from '../../../../tests/helpers/db';
import { stageOf, traceSql } from '../../../../tests/helpers/trace';

const setup = `
  create table measurement (city_id int not null, logdate date not null, peaktemp int,
    primary key (city_id, logdate)) partition by range (logdate);
  create table measurement_may partition of measurement
    for values from ('2024-05-01') to ('2024-06-01');
  create table measurement_june partition of measurement
    for values from ('2024-06-01') to ('2024-07-01');
`;

describe('маршрутизация INSERT по секциям', () => {
  it('берёт реальные секции и различает одинаковые ctid в разных секциях', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      const sql = `insert into measurement values (1, '2024-05-10', 20), (1, '2024-06-15', 25)
        returning city_id, logdate, peaktemp`;
      const direct = await inPreview(db, async () => {
        const result = await db.query(sql);
        const locations = await db.query(`select tableoid::regclass::text, city_id, logdate, peaktemp
          from measurement order by logdate`);
        return { result: result.rows, locations: locations.rows };
      });
      await inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual(direct.result);
        const stage = stageOf(trace, 'dml');
        expect(new Set(stage.inserted).size).toBe(2);
        expect(stage.routing?.map((group) => group.partitionId)).toEqual([
          'public.measurement_may',
          'public.measurement_june',
        ]);
        expect(
          stage.routing?.flatMap((group) =>
            group.added.rows.map((row) => [group.partitionId.split('.').at(-1), ...row.values]),
          ),
        ).toEqual(direct.locations);
        expect((await db.query('select count(*) from measurement')).rows).toEqual([[2]]);
        const parent = (await introspect(db)).tables.find((table) => table.id === 'public.measurement');
        expect(new Set(parent?.sampleCtids).size).toBe(2);
      });
      expect((await db.query('select count(*) from measurement')).rows).toEqual([[0]]);
    });
  });

  it('ошибка отсутствующей секции откатывает весь INSERT', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `insert into measurement values
          (1, '2024-05-10', 20), (1, '2024-08-01', 25)`,
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.error?.code).toBe('23514');
        expect((await db.query('select count(*) from measurement')).rows).toEqual([[0]]);
      });
    });
  });

  it('не повторяет неподдержанный ON CONFLICT и сохраняет результат', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `insert into measurement values (1, '2024-05-10', 20)
          on conflict do nothing returning city_id`,
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[1]]);
        expect((await db.query('select count(*) from measurement')).rows).toEqual([[1]]);
      });
    });
  });

  it('при пользовательском триггере не обещает полную анимацию и выполняет команду один раз', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`${setup}
        create table audit (id int);
        create function audit_measurement() returns trigger language plpgsql as $$
        begin insert into audit values (new.city_id); return new; end $$;
        create trigger audit_insert after insert on measurement for each row execute function audit_measurement();
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `insert into measurement values (1, '2024-05-10', 20) returning city_id`,
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[1]]);
        expect((await db.query('select * from audit')).rows).toEqual([[1]]);
      });
    });
  });

  it('при превышении лимита возвращает результат без повторной вставки', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await inPreview(db, async () => {
        const trace = await traceSql(
          db,
          `insert into measurement values
          (1, '2024-05-10', 20), (1, '2024-06-15', 25) returning city_id`,
          { maxRows: 1 },
        );
        expect(trace.mode).toBe('final-only');
        expect(trace.result?.rows).toEqual([[1], [1]]);
        expect((await db.query('select count(*) from measurement')).rows).toEqual([[2]]);
      });
    });
  });

  it('INSERT SELECT сохраняет существующие строки и выражения RETURNING', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await db.query("insert into measurement values (1, '2024-05-10', 20)");
      const sql = `insert into measurement select city_id + 1, logdate, peaktemp from measurement
        returning city_id * 10 as result`;
      const direct = await inPreview(db, () => db.query(sql));
      await inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.fields).toEqual(direct.fields);
        expect(trace.result?.rows).toEqual(direct.rows);
        expect(stageOf(trace, 'dml').output.rows).toHaveLength(2);
        expect(stageOf(trace, 'dml').routing?.[0].added.rows).toHaveLength(1);
      });
    });
  });

  it('находит конечную секцию в многоуровневом дереве', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table readings (day date, city int) partition by range (day);
        create table readings_year partition of readings for values from ('2024-01-01') to ('2025-01-01')
          partition by list (city);
        create table readings_city partition of readings_year for values in (1);
      `);
      await inPreview(db, async () => {
        const trace = await traceSql(db, "insert into readings values ('2024-05-10', 1) returning *");
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(stageOf(trace, 'dml').routing?.[0].partitionId).toBe('public.readings_city');
        expect(trace.result?.fields.map((field) => field.name)).toEqual(['day', 'city']);
      });
    });
  });

  it('пустой INSERT SELECT не создаёт выдуманных секций', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(setup);
      await inPreview(db, async () => {
        const trace = await traceSql(
          db,
          'insert into measurement select * from measurement returning city_id',
        );
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(trace.result?.rows).toEqual([]);
        expect(stageOf(trace, 'dml').routing).toEqual([]);
      });
    });
  });
});
