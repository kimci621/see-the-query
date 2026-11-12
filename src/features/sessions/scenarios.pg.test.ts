import { SCENARIOS } from '@content/scenarios';
import { describe, expect, it } from 'vitest';
import { runScenarioOnPostgres } from './pg-runner';
import type { Scenario } from './types';

const dsn = process.env.VS_PG_DSN;

describe.skipIf(!dsn)('сценарии двух сессий на PostgreSQL', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: шаги совпадают с реальным поведением`, async () => {
      const reports = await runScenarioOnPostgres(scenario, dsn as string);
      expect(reports.filter((report) => !report.ok)).toEqual([]);
    }, 30_000);
  }

  it('обнаруживает неверный ожидаемый результат', async () => {
    const scenario: Scenario = {
      id: 'wrong-result',
      title: '',
      intro: '',
      setup: '',
      steps: [{ session: 'a', caption: '', sql: 'select 1::text', expect: { rows: [['2']] } }],
    };
    expect((await runScenarioOnPostgres(scenario, dsn as string)).some((report) => !report.ok)).toBe(true);
  }, 30_000);

  it('обнаруживает отсутствие обещанной блокировки', async () => {
    const scenario: Scenario = {
      id: 'no-block',
      title: '',
      intro: '',
      setup: '',
      steps: [
        { session: 'a', caption: '', sql: 'select 1', fire: true, settlesAt: 1 },
        { session: 'b', caption: '', sql: 'select 2' },
      ],
    };
    expect((await runScenarioOnPostgres(scenario, dsn as string)).some((report) => !report.ok)).toBe(true);
  }, 30_000);
  it('обнаруживает досрочное снятие блокировки', async () => {
    const scenario: Scenario = {
      id: 'early-unlock',
      title: '',
      intro: '',
      setup: '',
      steps: [
        { session: 'a', caption: '', sql: 'begin' },
        { session: 'a', caption: '', sql: 'select 1 from book where book_id = 1 for update' },
        { session: 'b', caption: '', sql: 'begin' },
        {
          session: 'b',
          caption: '',
          sql: 'select 1 from book where book_id = 1 for update',
          fire: true,
          settlesAt: 5,
        },
        { session: 'a', caption: '', sql: 'commit' },
        { session: 'a', caption: '', sql: 'select 1' },
      ],
    };
    expect((await runScenarioOnPostgres(scenario, dsn as string)).some((report) => !report.ok)).toBe(true);
  }, 30_000);
});
