import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { clauseHighlight, setActiveClauseRange } from './highlight';

describe('подсветка клауз', () => {
  it('не падает, если при смене текста диапазон остался от прежнего запроса', () => {
    const state = EditorState.create({ doc: '', extensions: clauseHighlight() });
    expect(() => state.update({ effects: setActiveClauseRange.of({ from: 7, to: 0 }) }).state).not.toThrow();
    expect(() => state.update({ effects: setActiveClauseRange.of({ from: 0, to: 0 }) }).state).not.toThrow();
  });
});
