import { describe, expect, it } from 'vitest';
import { bookScan, fullPipelineTrace, testCtx } from '../__fixtures__/traces';
import type { StageOf } from '../types';
import { materializeAnimator } from './materialize';

describe('materializeAnimator', () => {
  it('рисует пунктирную таблицу SELECT в рабочей зоне', () => {
    const stage: StageOf<'materialize'> = {
      id: 'm',
      kind: 'materialize',
      name: 'SELECT',
      inner: fullPipelineTrace(),
      caption: 'SELECT: 5 строк',
      output: bookScan().output,
    };
    const [phase] = materializeAnimator({ tables: [], decorations: [] }, stage, 0, testCtx());
    expect(phase.frame.tables[0]).toMatchObject({ title: 'SELECT', dashed: true, x: 500, y: 0 });
  });
});
