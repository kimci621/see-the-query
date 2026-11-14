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
        const range = e.value;
        next =
          range && range.from >= 0 && range.from < range.to && range.to <= tr.newDoc.length
            ? Decoration.set([mark.range(range.from, range.to)])
            : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function clauseHighlight(): Extension {
  return [clauseField];
}
