import { describe, expect, it } from 'vitest';
import { foldWidth } from '@/features/board/layout';
import { bookScan, testCtx } from '../__fixtures__/traces';
import { rebuildTable } from '../frame';
import { ghostWidth } from '../geometry';
import { scanAnimator } from './scan';

describe('scanAnimator', () => {
  it('призрак появляется поверх ноды и уезжает в рабочую зону', () => {
    const phases = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx());
    expect(phases).toHaveLength(2);
    const [appear, move] = phases;
    expect(appear.frame.tables[0]).toMatchObject({ id: 't:b', title: 'book b', x: 0, y: 0 });
    expect(move.frame.tables[0]).toMatchObject({ x: 500, y: 0 });
    expect(move.frame.tables[0].rows).toHaveLength(5);
    expect(move.caption).toBe('FROM book: 5 строк');
    expect(phases.every((p) => p.stageIndex === 0)).toBe(true);
    expect(phases.every((p) => p.durationMs >= 400 && p.durationMs <= 900)).toBe(true);
  });

  it('без ноды на доске призрак сразу появляется в рабочей зоне', () => {
    const phases = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx({}));
    expect(phases[0].frame.tables[0]).toMatchObject({ x: 500, y: 0 });
  });

  it('читает материализованный источник без дубля и внутреннего имени', () => {
    const materialized = {
      ...rebuildTable({ id: 'm:0', title: 'j', x: 500, y: 0 }, bookScan().output),
      dashed: true,
    };
    const phases = scanAnimator(
      { tables: [materialized], decorations: [] },
      { ...bookScan(), alias: 'j', tableId: 'pg_temp.__vs_f42', sourceName: 'j' },
      1,
      testCtx({}),
    );
    for (const phase of phases) {
      expect(phase.frame.tables).toHaveLength(1);
      expect(phase.frame.tables[0]).toMatchObject({ id: 't:j', title: 'j', x: 500, y: 0 });
    }
  });

  it('при псевдониме читает ту же материализацию под её именем', () => {
    const materialized = {
      ...rebuildTable({ id: 'm:0', title: 'chosen', x: 500, y: 0 }, bookScan().output),
      dashed: true,
    };
    const [phase] = scanAnimator(
      { tables: [materialized], decorations: [] },
      { ...bookScan(), alias: 'c', tableId: 'pg_temp.__vs_m42', sourceName: 'chosen' },
      1,
      testCtx({}),
    );
    expect(phase.frame.tables).toHaveLength(1);
    expect(phase.frame.tables[0]).toMatchObject({ id: 't:c', title: 'chosen c' });
  });

  it('второй scan встаёт правее первого', () => {
    const first = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, testCtx());
    const second = scanAnimator(first[1].frame, { ...bookScan(), alias: 'b2' }, 1, testCtx());
    const tables = second[1].frame.tables;
    expect(tables).toHaveLength(2);
    expect(tables[1].x).toBeGreaterThan(tables[0].x + 3 * 132);
  });

  it('широкая таблица свёрнута, как нода: те же колонки, заглушка и ширина', () => {
    const ctx = { ...testCtx(), folded: (id: string) => (id === 'public.book' ? ['title'] : []) };
    const [appear] = scanAnimator({ tables: [], decorations: [] }, bookScan(), 0, ctx);
    const t = appear.frame.tables[0];
    expect(t.columns.map((c) => c.name)).toEqual(['book_id', 'price']);
    expect(t.rows[0].values).toEqual([1, '890.00']);
    expect(t).toMatchObject({ fold: ['b.title'], folds: [{ at: 2, count: 1 }] });
    const node = { visible: [{}, {}], hidden: [{}] } as Parameters<typeof foldWidth>[0];
    expect(ghostWidth(t)).toBe(foldWidth(node));
    // следующая стадия пересобирает таблицу из своего выхода, свёртка остаётся
    const next = rebuildTable(t, bookScan().output);
    expect(next.columns.map((c) => c.name)).toEqual(['book_id', 'price']);
    expect(next.folds).toEqual([{ at: 2, count: 1 }]);
  });
});
