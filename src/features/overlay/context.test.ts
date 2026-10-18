import { describe, expect, it } from 'vitest';
import { EMPTY_SCHEMA } from './__fixtures__/traces';
import { makeAnimatorContext, WORK_AREA_GAP } from './context';

const api = {
  getInternalNode: (id: string) =>
    id === 'public.book'
      ? { internals: { positionAbsolute: { x: 40, y: 60 } }, measured: { width: 260, height: 300 } }
      : undefined,
  getNodes: () => [{ id: 'public.book' }],
  getNodesBounds: () => ({ x: 40, y: 60, width: 900, height: 500 }),
};

describe('makeAnimatorContext', () => {
  it('nodeRect берёт абсолютную позицию и измеренный размер ноды', () => {
    const ctx = makeAnimatorContext(api, EMPTY_SCHEMA);
    expect(ctx.nodeRect('public.book')).toEqual({ x: 40, y: 60, width: 260, height: 300 });
    expect(ctx.nodeRect('public.nope')).toBeNull();
  });

  it('рабочая зона правее всех таблиц доски', () => {
    const ctx = makeAnimatorContext(api, EMPTY_SCHEMA);
    expect(ctx.workArea).toEqual({ x: 40 + 900 + WORK_AREA_GAP, y: 60 });
  });

  it('пустая доска: рабочая зона в начале координат', () => {
    const ctx = makeAnimatorContext({ ...api, getNodes: () => [] }, EMPTY_SCHEMA);
    expect(ctx.workArea).toEqual({ x: 0, y: 0 });
  });
});
