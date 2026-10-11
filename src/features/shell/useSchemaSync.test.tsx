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
  });

  it('кладёт схему при старте и после changed', async () => {
    introspect.mockResolvedValueOnce(schemaA).mockResolvedValueOnce(schemaB);
    renderHook(() => useSchemaSync());
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaA));
    listener({ type: 'changed' });
    await waitFor(() => expect(useBoardStore.getState().schema).toBe(schemaB));
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
});
