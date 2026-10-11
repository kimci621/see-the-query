import { describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { traceSql } from '../../../tests/helpers/trace';
import { bigFilterTrace, fullPipelineTrace, testCtx } from './__fixtures__/traces';
import { buildPlayback, lastPhaseOfStage, stageOfPhase } from './playback';

describe('buildPlayback', () => {
  it('полный конвейер даёт фазы всех стадий по порядку', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    // scan 2 + filter 3 + project 2 + sort 2 + limit 2
    expect(p.phases).toHaveLength(11);
    expect(p.stageStarts).toEqual([0, 2, 5, 7, 9]);
    expect(p.phases.map((ph) => ph.stageIndex)).toEqual([0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('последний кадр совпадает с результатом запроса', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    const last = p.phases[p.phases.length - 1].frame.tables[0];
    expect(last.rows.map((r) => r.values)).toEqual([
      ['Python. К вершинам мастерства', '2400.00', '2160.000'],
      ['Тихий Дон', '890.00', '801.000'],
    ]);
  });

  it('final-only даёт пустое проигрывание', () => {
    const t: Trace = { ...fullPipelineTrace(), mode: 'final-only', fallbackReason: 'LATERAL пока не умею' };
    expect(buildPlayback(t, testCtx())).toEqual({ phases: [], stageStarts: [] });
  });

  it('стадия без своего аниматора идёт через generic', () => {
    const t = fullPipelineTrace();
    const window = {
      ...t.stages[2],
      kind: 'window',
      partitions: [],
      computed: [],
    } as unknown as Trace['stages'][number];
    const p = buildPlayback({ ...t, stages: [t.stages[0], window] }, testCtx());
    expect(p.phases[p.phases.length - 1].id).toBe('1:result');
  });

  it('стадия на 500 строк рисует 20 строк и hiddenRows', () => {
    const p = buildPlayback(bigFilterTrace(500), testCtx());
    const scanEnd = p.phases[p.stageStarts[1] - 1].frame.tables[0];
    expect(scanEnd.rows).toHaveLength(20);
    expect(scanEnd.hiddenRows).toBe(480);
    const last = p.phases[p.phases.length - 1].frame.tables[0];
    expect(last.rows).toHaveLength(20);
    expect(last.hiddenRows).toBe(230);
  });

  it('lastPhaseOfStage и stageOfPhase', () => {
    const p = buildPlayback(fullPipelineTrace(), testCtx());
    expect(lastPhaseOfStage(p, 1)).toBe(4);
    expect(lastPhaseOfStage(p, 4)).toBe(10);
    expect(stageOfPhase(p, 6)).toBe(2);
  });
});

// Настоящие трассы Ф5 на bookstore: форматы стадий совпадают с тем, что ждут аниматоры
describe('buildPlayback на трассе Ф5', () => {
  const sql = 'select title, price from book where price > 500 order by price desc limit 3';

  it('последний кадр равен результату Postgres, ключ сортировки подсвечен', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        const p = buildPlayback(trace, testCtx());
        const last = p.phases[p.phases.length - 1].frame.tables[0];
        expect(last.rows.map((r) => r.values)).toEqual(trace.result?.rows);
        const sort = p.phases[lastPhaseOfStage(p, 3)].frame.tables[0];
        expect(sort.columns.find((c) => c.name === 'price')?.state).toBe('key');
      }),
    ));

  it('сжатый режим: строк нет, счётчики по rowCount', () =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql, { maxRows: 5 });
        const p = buildPlayback(trace, testCtx());
        const last = p.phases[p.phases.length - 1].frame;
        expect(last.tables[0].rows).toEqual([]);
        expect(last.tables[0].hiddenRows).toBe(3);
        expect(last.decorations).toContainEqual(expect.objectContaining({ kind: 'counter', text: '7 → 3' }));
      }),
    ));
});
