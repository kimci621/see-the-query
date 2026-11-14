import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BTreeSceneData } from '@/features/scenes/btree-scene';
import { useSettingsStore } from '@/stores/settings';
import { BTreePlayer } from './BTreeScene';

const data: BTreeSceneData = {
  index: {
    tableId: 'public.orders',
    column: 'order_id',
    rootPage: 3,
    level: 1,
    pages: 4,
    rootItems: [{ offset: 1, key: null, ctid: '(4,1)' }],
  },
  initialLeaf: 4,
  targetLeaf: 4,
  heapCtid: '(1,2)',
  heapPages: 20,
  tableRows: 1000,
  seqPlan: { nodeType: 'Seq Scan', actualRows: 1, rowsRemoved: 999, loops: 1, children: [] },
  indexPlan: { nodeType: 'Index Scan', actualRows: 1, loops: 1, sharedHitBlocks: 2, children: [] },
};

describe('сцена B-дерева', () => {
  afterEach(() => useSettingsStore.setState({ locale: 'ru' }));

  it('на английском показывает путь и фактические данные индекса', () => {
    useSettingsStore.setState({ locale: 'en' });
    render(<BTreePlayer data={data} value={5} />);
    const scene = screen.getByRole('region', { name: 'B-tree search' });
    expect(within(scene).getByText('Table pages')).toBeVisible();
    const next = within(scene).getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(within(scene).getByRole('region', { name: 'Search path' })).toHaveTextContent('Key 5');
    expect(within(scene).getByText('(1,2)')).toBeVisible();
  });
});
