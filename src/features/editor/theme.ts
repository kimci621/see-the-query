import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Тема на CSS-переменных из editor.css: одна тема работает в светлой и тёмной схеме
export function editorTheme(): Extension[] {
  return [
    EditorView.theme({
      '&': {
        fontSize: '0.8125rem',
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--editor-fg)',
        fontFamily: 'var(--font-mono)',
        height: '100%',
      },
      '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' },
      '.cm-scroller': { overflow: 'auto', lineHeight: '1.6' },
      '.cm-content': { caretColor: 'var(--editor-fg)', padding: '8px 0' },
      '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-muted)', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--editor-fg) 6%, transparent)' },
      '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklab, var(--editor-fg) 8%, transparent)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in oklab, var(--touched) 24%, transparent)',
      },
      '.cm-cursor': { borderLeftColor: 'var(--editor-fg)' },
      '.cm-tooltip': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent)',
        color: 'var(--accent-foreground)',
      },
      // ключ на доске значит PK, поэтому у ключевых слов в автокомплите буква
      '.cm-completionIcon-keyword:after': { content: "'K'" },
      '.cm-clauseActive': {
        backgroundColor: 'color-mix(in oklab, var(--touched) 14%, transparent)',
        borderRadius: '2px',
      },
    }),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, class: 'tok-keyword' },
        { tag: [tags.string, tags.special(tags.string)], class: 'tok-string' },
        { tag: [tags.number, tags.bool], class: 'tok-number' },
        { tag: tags.comment, class: 'tok-comment' },
        {
          tag: [tags.variableName, tags.propertyName, tags.definition(tags.variableName)],
          class: 'tok-identifier',
        },
        { tag: [tags.operator, tags.punctuation, tags.bracket], class: 'tok-operator' },
        { tag: tags.null, class: 'tok-number' },
      ]),
    ),
  ];
}
