import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { type Diagnostic, linter, setDiagnostics } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { type EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { useResolvedTheme } from '@/app/ThemeProvider';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { buildSchemaSpec } from './completion';
import { parseDiagnostic, pgDiagnostic } from './diagnostics';
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
  const parseError = useEditorStore((s) => s.parseError);
  const traceError = useSceneStore((s) => s.trace?.error ?? null);
  const traceSql = useSceneStore((s) => s.trace?.sql ?? null);
  const schema = useBoardStore((s) => s.schema);
  const resolved = useResolvedTheme();
  const viewRef = useRef<EditorView | null>(null);

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

  // Программные диагностики: lint-расширение уже зарегистрировано в extensions
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diags: Diagnostic[] = [];
    if (parseError) {
      const d = parseDiagnostic(view.state.doc.toString(), parseError);
      diags.push({ ...d, severity: 'error', source: 'SQL' });
    }
    if (traceError && traceSql) {
      const d = pgDiagnostic(view.state.doc.toString(), traceSql, traceError);
      if (d) diags.push({ ...d, severity: 'error', source: 'PostgreSQL' });
    }
    view.dispatch(setDiagnostics(view.state, diags));
  }, [parseError, traceError, traceSql]);

  return (
    <CodeMirror
      ref={ref}
      value={text}
      theme={resolved}
      height="100%"
      extensions={extensions}
      onChange={setText}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      onUpdate={(vu: ViewUpdate) => {
        if (vu.selectionSet || vu.docChanged) setCursor(vu.state.selection.main.head);
      }}
    />
  );
});
