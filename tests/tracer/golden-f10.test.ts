import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';
import { GOLDEN_F10 } from './golden-f10.queries';

// Каждый запрос Ф10: трасса full (сверка с прямым выполнением прошла) и ожидаемые стадии
describe('golden Ф10: подзапросы, CTE, множества и окна', () => {
  it.each(GOLDEN_F10)('$sql', ({ sql, stages, dataset }) =>
    withDataset(dataset, (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(stages);
      }),
    ),
  );
});
