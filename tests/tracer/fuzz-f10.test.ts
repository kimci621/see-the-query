import { describe, expect, it } from 'vitest';
import { rowCanon } from '@/features/tracer/verify';
import { inPreview, withDataset } from '../helpers/db';
import { traceSql } from '../helpers/trace';
import { fuzzF10Queries } from './fuzz-f10';

const QUERIES = fuzzF10Queries(20261103, 200);
const MISMATCH = 'Сверка с прямым выполнением не сошлась';

describe('фаззер Ф10: подзапросы, CTE, множества и окна', () => {
  it('генератор детерминирован', () => {
    expect(fuzzF10Queries(20261103, 5)).toEqual(QUERIES.slice(0, 5));
  });

  it(
    '200 запросов: full совпадает с прямым выполнением, final-only с причиной',
    () =>
      withDataset('bookstore', (db) =>
        inPreview(db, async () => {
          const reasons = new Map<string, string[]>();
          for (const sql of QUERIES) {
            const trace = await traceSql(db, sql, { maxRows: 100 });
            const reason = trace.mode === 'full' ? 'full' : (trace.fallbackReason ?? '?');
            reasons.set(reason, [...(reasons.get(reason) ?? []), sql]);
            if (trace.mode !== 'full') {
              expect(reason.trim(), sql).not.toBe('');
              continue;
            }
            const direct = await db.query(sql);
            const ours = (trace.result?.rows ?? []).map(rowCanon).sort();
            const theirs = direct.rows.map(rowCanon).sort();
            expect(ours, sql).toEqual(theirs);
          }
          expect(reasons.get(MISMATCH) ?? []).toEqual([]);
          const full = reasons.get('full')?.length ?? 0;
          const spread = [...reasons].map(([r, qs]) => `${qs.length} × ${r}: ${qs[0]}`).join('\n');
          expect(full / QUERIES.length, spread).toBeGreaterThanOrEqual(0.85);
        }),
      ),
    300_000,
  );
});
