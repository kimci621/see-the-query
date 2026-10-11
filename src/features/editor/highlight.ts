import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

// Диапазон активного клауза из React-мира (эффект EditorPane) в декорацию CodeMirror
export const setActiveClauseRange = StateEffect.define<{ from: number; to: number } | null>();

const mark = Decoration.mark({ class: 'cm-clauseActive' });

const clauseField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setActiveClauseRange)) {
        next = e.value ? Decoration.set([mark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function clauseHighlight(): Extension {
  return [clauseField];
}
