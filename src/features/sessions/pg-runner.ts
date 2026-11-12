import { randomUUID } from 'node:crypto';
import pg, { type Client as PgClient } from 'pg';
import { loadDatasetSql } from '@/features/db/datasets';
import type { Scenario, ScenarioStep } from './types';

export interface StepReport {
  index: number;
  ok: boolean;
  problem?: string;
}

type Outcome = { rows: unknown[][] } | { error: unknown };
type Pending = { index: number; step: ScenarioStep; promise: Promise<Outcome>; finished: boolean };

function execute(client: PgClient, sql: string): Promise<Outcome> {
  return client.query({ text: sql, rowMode: 'array' }).then(
    (result) => ({ rows: result.rows as unknown[][] }),
    (error: unknown) => ({ error }),
  );
}

function check(index: number, step: ScenarioStep, outcome: Outcome): StepReport {
  if ('error' in outcome) {
    const code = (outcome.error as { code?: string }).code;
    return code === step.expectError && code !== undefined
      ? { index, ok: true }
      : { index, ok: false, problem: `Неожиданная ошибка: ${String(code ?? outcome.error)}` };
  }
  if (step.expectError) return { index, ok: false, problem: `Ожидалась ошибка ${step.expectError}` };
  if (step.expect?.rows && JSON.stringify(outcome.rows) !== JSON.stringify(step.expect.rows)) {
    return {
      index,
      ok: false,
      problem: `Ожидалось ${JSON.stringify(step.expect.rows)}, получено ${JSON.stringify(outcome.rows)}`,
    };
  }
  return { index, ok: true };
}

async function timed<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Истёк срок ожидания запроса')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runScenarioOnPostgres(scenario: Scenario, dsn: string): Promise<StepReport[]> {
  const clients = {
    a: new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 5000 }),
    b: new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 5000 }),
    ctrl: new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 5000 }),
  };
  const schema = `vs_${randomUUID().replaceAll('-', '')}`;
  const reports: StepReport[] = [];
  const pending = new Map<'a' | 'b', Pending>();
  const pids: Partial<Record<'a' | 'b', number>> = {};
  const connected = new Set<PgClient>();
  let schemaCreated = false;
  try {
    for (const client of Object.values(clients)) {
      await client.connect();
      connected.add(client);
    }
    await clients.ctrl.query(`create schema "${schema}"`);
    schemaCreated = true;
    for (const client of Object.values(clients)) await client.query(`set search_path to "${schema}", public`);
    for (const session of ['a', 'b'] as const) {
      const result = await clients[session].query('select pg_backend_pid() as pid');
      pids[session] = result.rows[0].pid as number;
      await clients[session].query("set statement_timeout = '7s'");
    }
    await clients.ctrl.query(await loadDatasetSql('bookstore'));
    if (scenario.setup) await clients.ctrl.query(scenario.setup);

    for (const [index, step] of scenario.steps.entries()) {
      if (pending.has(step.session)) {
        reports.push({ index, ok: false, problem: 'Сессия ещё ожидает завершения запроса' });
        break;
      }
      if (step.fire) {
        const item: Pending = {
          index,
          step,
          promise: execute(clients[step.session], step.sql),
          finished: false,
        };
        item.promise.then(() => {
          item.finished = true;
        });
        pending.set(step.session, item);
        const other = step.session === 'a' ? 'b' : 'a';
        const until = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < until && !item.finished) {
          const result = await clients.ctrl.query(
            'select $1::int = any(pg_blocking_pids($2::int)) as blocked',
            [pids[other], pids[step.session]],
          );
          if (result.rows[0].blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (!blocked) {
          reports.push({ index, ok: false, problem: 'Запрос не ждёт блокировку другой сессии' });
          break;
        }
      } else {
        try {
          const report = check(index, step, await timed(execute(clients[step.session], step.sql), 5000));
          reports.push(report);
          if (!report.ok) break;
        } catch (error) {
          reports.push({ index, ok: false, problem: String(error) });
          break;
        }
      }
      for (const [session, item] of pending) {
        if (item.step.settlesAt !== index) {
          if (item.index !== index) {
            const other = session === 'a' ? 'b' : 'a';
            const state = await clients.ctrl.query(
              'select $1::int = any(pg_blocking_pids($2::int)) as blocked',
              [pids[other], pids[session]],
            );
            if (!state.rows[0].blocked) {
              reports.push({
                index: item.index,
                ok: false,
                problem: 'Ожидание закончилось до указанного шага',
              });
              break;
            }
          }
          continue;
        }
        try {
          const report = check(item.index, item.step, await timed(item.promise, 5000));
          reports.push(report);
          pending.delete(session);
          if (!report.ok) break;
        } catch (error) {
          reports.push({ index: item.index, ok: false, problem: String(error) });
        }
      }
      if (reports.some((report) => !report.ok)) break;
    }
    if (pending.size && !reports.some((report) => !report.ok)) {
      reports.push({ index: scenario.steps.length, ok: false, problem: 'Ожидающий запрос не завершился' });
    }
    return reports;
  } finally {
    if (connected.has(clients.ctrl)) {
      for (const session of ['a', 'b'] as const) {
        if (pids[session])
          await clients.ctrl.query('select pg_cancel_backend($1)', [pids[session]]).catch(() => {});
      }
    }
    for (const session of ['a', 'b'] as const) {
      if (connected.has(clients[session])) await clients[session].query('rollback').catch(() => {});
    }
    try {
      if (schemaCreated && scenario.cleanup) await clients.ctrl.query(scenario.cleanup);
    } finally {
      try {
        if (schemaCreated) await clients.ctrl.query(`drop schema "${schema}" cascade`);
      } finally {
        await Promise.allSettled([...connected].map((client) => client.end()));
      }
    }
  }
}
