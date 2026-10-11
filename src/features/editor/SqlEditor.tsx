import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { keymap, type ViewUpdate } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useMemo, useRef } from 'react';
import { useResolvedTheme } from '@/app/ThemeProvider';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { buildSchemaSpec } from './completion';
import { editorTheme } from './theme';

export interface SqlEditorProps {
  onApply?: () => void;
  extraExtensions?: Extension[];
}

// linter(() => []) обязателен: расширение lint регистрирует StateField,
// в который эффектами кладутся программные диагностики (setDiagnostics, задача 8)
export const SqlEditor = forwardRef<ReactCodeMirrorRef, SqlEditorProps>(function SqlEditor(
  { onApply, extraExtensions = [] },
  ref,
) {
  const text = useEditorStore((s) => s.text);
  const setText = useEditorStore((s) => s.setText);
  const setCursor = useEditorStore((s) => s.setCursor);
  const schema = useBoardStore((s) => s.schema);
  const resolved = useResolvedTheme();

  // onApply меняется каждый рендер панели: замыкаем через ref, чтобы extensions не пересоздавались
  const applyRef = useRef(onApply);
  applyRef.current = onApply;

  const extensions = useMemo(
    () => [
      sql({
        dialect: PostgreSQL,
        upperCaseKeywords: false,
        schema: schema ? buildSchemaSpec(schema) : undefined,
      }),
      linter(() => []),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            applyRef.current?.();
            return true;
          },
        },
      ]),
      editorTheme(),
      ...extraExtensions,
    ],
    [schema, extraExtensions],
  );

  return (
    <CodeMirror
      ref={ref}
      value={text}
      theme={resolved}
      height="100%"
      extensions={extensions}
      onChange={setText}
      onUpdate={(vu: ViewUpdate) => {
        if (vu.selectionSet || vu.docChanged) setCursor(vu.state.selection.main.head);
      }}
    />
  );
});
