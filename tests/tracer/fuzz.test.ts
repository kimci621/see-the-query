import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { traceSql } from '../helpers/trace';
import { fuzzQueries } from './fuzz-gen';

const QUERIES = fuzzQueries(20261008, 250);
const MISMATCH = 'Сверка с прямым выполнением не сошлась';

describe('фаззер трассировщика', () => {
  it('генератор детерминирован', () => {
    expect(fuzzQueries(20261008, 5)).toEqual(QUERIES.slice(0, 5));
  });
  it(
    'трасса либо full, либо честный final-only; full не меньше 80%',
    () =>
      withDataset('bookstore', (db) =>
        inPreview(db, async () => {
          const reasons = new Map<string, string[]>();
          for (const sql of QUERIES) {
            const trace = await traceSql(db, sql);
            const reason = trace.mode === 'full' ? 'full' : (trace.fallbackReason ?? '?');
            reasons.set(reason, [...(reasons.get(reason) ?? []), sql]);
          }
          expect(reasons.get(MISMATCH) ?? []).toEqual([]);
          const full = reasons.get('full')?.length ?? 0;
          const spread = [...reasons].map(([r, qs]) => `${qs.length} × ${r}: ${qs[0]}`).join('\n');
          expect(full / QUERIES.length, spread).toBeGreaterThanOrEqual(0.8);
        }),
      ),
    240_000,
  );
});
