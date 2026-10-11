import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/stores/editor';
import { EditorPane } from './EditorPane';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ lessonId: null }),
}));

describe('EditorPane', () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it('набор текста пишется в стор редактора', async () => {
    render(<EditorPane />);
    const user = userEvent.setup();
    // CodeMirror лениво загрузился и сфокусировался
    const editor = await waitFor(() => {
      const el = document.querySelector('.cm-content');
      if (el instanceof HTMLElement) return el;
      throw new Error('редактор не загрузился');
    });
    await user.click(editor);
    await user.keyboard('select 1');
    expect(useEditorStore.getState().text).toBe('select 1');
    expect(useEditorStore.getState().cursor).toBe(8);
  });
});
