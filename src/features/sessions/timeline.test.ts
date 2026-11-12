import { SCENARIOS } from '@content/scenarios';
import { describe, expect, it } from 'vitest';
import { buildTimeline, visibleSnapshot } from './timeline';
import type { Scenario } from './types';

const demo: Scenario = {
  id: 'demo',
  title: 'Пример',
  intro: '',
  setup: '',
  steps: [
    { session: 'a', caption: 'A начала', sql: 'begin' },
    {
      session: 'b',
      caption: 'B ждёт',
      sql: 'select 1 for update',
      fire: true,
      settlesAt: 3,
      note: 'B ждёт A',
      settledNote: 'B получила блокировку',
    },
    { session: 'a', caption: 'A читает', sql: 'select 1', expect: { rows: [['1']] }, note: 'A видит 1' },
    { session: 'a', caption: 'A завершила', sql: 'commit' },
    { session: 'b', caption: 'B читает', sql: 'select 2', expect: { rows: [['2']] }, note: 'B видит 2' },
  ],
};

describe('сценарий двух сессий', () => {
  it('ожидающий запрос остаётся запущенным до шага освобождения', () => {
    expect(buildTimeline(demo, 0).map((f) => f.state)).toEqual([
      'done',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(buildTimeline(demo, 2).map((f) => f.state)).toEqual([
      'done',
      'running',
      'done',
      'pending',
      'pending',
    ]);
    expect(buildTimeline(demo, 3).map((f) => f.state)).toEqual(['done', 'done', 'done', 'done', 'pending']);
    expect(buildTimeline(demo, 2).map((f) => f.session)).toEqual(['a', 'b', 'a', 'a', 'b']);
  });

  it('заменяет устаревшие наблюдения при завершении ожидания', () => {
    expect(visibleSnapshot(demo, 1)).toEqual(['B ждёт A']);
    expect(visibleSnapshot(demo, 3)).toEqual(['A видит 1', 'B получила блокировку']);
    expect(visibleSnapshot(demo, 4)).toEqual(['A видит 1', 'B видит 2']);
  });

  it('сценарии имеют уникальные идентификаторы и точки завершения ожиданий', () => {
    expect(new Set(SCENARIOS.map((sc) => sc.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.map((sc) => sc.id)).toEqual(
      expect.arrayContaining([
        'tx-basic',
        'tx-rollback',
        'savepoint',
        'non-repeatable-read',
        'repeatable-read',
        'lock-for-update',
        'deadlock',
      ]),
    );
    for (const scenario of SCENARIOS) {
      expect(scenario.steps.length).toBeGreaterThan(0);
      scenario.steps.forEach((step, index) => {
        if (step.fire) {
          expect(step.settlesAt).toBeGreaterThan(index);
          expect(step.settlesAt).toBeLessThan(scenario.steps.length);
          expect(step.settledNote).toBeTruthy();
          const release = scenario.steps[step.settlesAt ?? -1];
          expect(release?.session).not.toBe(step.session);
          expect(
            Boolean(release?.sql.match(/^(commit|rollback)$/i) || release?.expectError === '40P01'),
          ).toBe(true);
        }
      });
    }
  });
});
