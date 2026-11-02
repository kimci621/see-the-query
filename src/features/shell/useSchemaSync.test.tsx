import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { SandboxEvent } from '@/features/db/sandbox';
import { useBoardStore } from '@/stores/board';
import { useSchemaSync } from './useSchemaSync';

const schemaA: SchemaSnapshot = { schemas: ['public'], tables: [], fks: [], sequences: [] };
const schemaB: SchemaSnapshot = { schemas: ['public', 'shop'], tables: [], fks: [], sequences: [] };

const introspect = vi.fn<() => Promise<SchemaSnapshot>>();
vi.mock('@/features/db/introspect', () => ({ introspect: () => introspect() }));

let listener: (e: SandboxEvent) => void = () => undefined;
const sandbox = {
  status: 'ready',
  client: () => ({}),
  preview: vi.fn((fn: (db: object) => Promise<SchemaSnapshot>) => fn({})),
  datasetTables: () => ['public.book'],
  subscribe: (l: (e: SandboxEvent) => void) => {
    listener = l;
    return () => undefined;
  },
};
vi.mock('@/features/db/SandboxProvider', () => ({
  useSandbox: () => ({ sandbox, status: 'ready', version: null }),
}));

describe('useSchemaSync', () => {
  beforeEach(() => {
    useBoardStore.setState(useBoardStore.getInitialState(), true);
    introspect.mockReset();
    sandbox.preview.mockImplementation((fn) => fn({}));
  });

  it('кладёт схему при старте и после changed', async () => {
    introspect.mockResolvedValueOnce(schemaA).mockResolvedValueOnce(schemaB);
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));
    listener({ type: 'changed' });
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaB));
  });

  it('ждёт окончания другого превью перед чтением схемы', async () => {
    let finishPreview: () => void = () => undefined;
    const busy = new Promise<void>((resolve) => {
      finishPreview = resolve;
    });
    sandbox.preview.mockImplementation((fn) => busy.then(() => fn({})));
    introspect.mockResolvedValue(schemaA);
    renderHook(() => useSchemaSync());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useBoardStore.getState().schema).toBeNull();
    finishPreview();
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));
  });

  it('таблицы вне датасета уходят в userTables', async () => {
    const table = (id: string) => ({ id }) as SchemaSnapshot['tables'][number];
    introspect.mockResolvedValueOnce({ ...schemaA, tables: [table('public.book'), table('public.mine')] });
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().userTables).toEqual(['public.mine']));
  });

  it('медленный старый ответ не перетирает новый', async () => {
    let resolveOld: (s: SchemaSnapshot) => void = () => undefined;
    introspect.mockReturnValueOnce(new Promise((r) => (resolveOld = r))).mockResolvedValueOnce(schemaB);
    renderHook(() => useSchemaSync());
    listener({ type: 'changed' });
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaB));
    resolveOld(schemaA);
    await new Promise((r) => setTimeout(r, 0));
    expect(useBoardStore.getState().schema).toBe(schemaB);
  });

  it('пересборка под другой урок сбрасывает схему и отбрасывает летящий ответ', async () => {
    let resolveOld: (s: SchemaSnapshot) => void = () => undefined;
    introspect.mockResolvedValueOnce(schemaA).mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));
    listener({ type: 'changed' });
    listener({ type: 'rebuilding' });
    expect(useBoardStore.getState().schema).toBeNull();
    resolveOld(schemaB);
    await new Promise((r) => setTimeout(r, 0));
    expect(useBoardStore.getState().schema).toBeNull();
  });

  it('после «Применить» пометки копятся, отмена и другие изменения их снимают (P8.16)', async () => {
    introspect.mockResolvedValue(schemaA);
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));
    listener({ type: 'changed', apply: { since: 750, command: 'INSERT' } });
    await waitFor(() => expect(useBoardStore.getState().rowWrites).toEqual([{ since: 750, mark: 'new' }]));
    listener({ type: 'changed', apply: { since: 751, command: 'UPDATE' } });
    await waitFor(() =>
      expect(useBoardStore.getState().rowWrites).toEqual([
        { since: 750, mark: 'new' },
        { since: 751, mark: 'changed' },
      ]),
    );
    listener({ type: 'changed' });
    await waitFor(() => expect(useBoardStore.getState().rowWrites).toEqual([]));
  });

  it('INSERT и CREATE TABLE обновляют схему и пометки вместе, по одному разу на применение', async () => {
    const table = (id: string) => ({ id }) as SchemaSnapshot['tables'][number];
    const inserted = { ...schemaA, tables: [table('public.book')] };
    const created = { ...schemaA, tables: [table('public.book'), table('public.mine')] };
    introspect.mockResolvedValueOnce(schemaA).mockResolvedValueOnce(inserted).mockResolvedValueOnce(created);
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));

    const updates: Array<
      Pick<ReturnType<typeof useBoardStore.getState>, 'schema' | 'rowWrites' | 'userTables'>
    > = [];
    const unsubscribe = useBoardStore.subscribe(({ schema, rowWrites, userTables }) => {
      updates.push({ schema, rowWrites, userTables });
    });
    try {
      listener({ type: 'changed', apply: { since: 750, command: 'INSERT' } });
      await waitFor(() => expect(useBoardStore.getState().schema).toBe(inserted));
      listener({ type: 'changed', apply: { since: 751, command: 'CREATE' } });
      await waitFor(() => expect(useBoardStore.getState().schema).toBe(created));
      expect(updates).toEqual([
        { schema: inserted, rowWrites: [{ since: 750, mark: 'new' }], userTables: [] },
        {
          schema: created,
          rowWrites: [
            { since: 750, mark: 'new' },
            { since: 751, mark: 'new' },
          ],
          userTables: ['public.mine'],
        },
      ]);
    } finally {
      unsubscribe();
    }
  });
});
