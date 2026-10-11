import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../helpers/db';
import { summary, traceSql } from '../helpers/trace';
import { GOLDEN } from './golden.queries';

// Каждый запрос: трасса full (значит, сверка с прямым выполнением прошла) и ожидаемые стадии
describe('golden: трасса совпадает с прямым выполнением', () => {
  it.each(GOLDEN)('$sql', ({ sql, stages }) =>
    withDataset('bookstore', (db) =>
      inPreview(db, async () => {
        const trace = await traceSql(db, sql);
        expect(trace.mode, trace.fallbackReason).toBe('full');
        expect(summary(trace)).toBe(stages);
      }),
    ),
  );
});
