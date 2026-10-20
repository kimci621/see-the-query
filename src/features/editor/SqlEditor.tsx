import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { type Diagnostic, setDiagnostics } from '@codemirror/lint';
import { type Extension, Prec } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, type ViewUpdate } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { clauseRanges } from '@/features/sql/clauses';
import { parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { buildSchemaSpec } from './completion';
import { parseDiagnostic, pgDiagnostic } from './diagnostics';
import { clauseHighlight, setActiveClauseRange } from './highlight';
import { columnContextAt } from './hover';
import { editorTheme } from './theme';
import { resolveColumn } from './touched';
import { useTypingError } from './useTypingError';

export interface SqlEditorProps {
  onApply?: () => void;
  extraExtensions?: Extension[];
}

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
  // имя на полуслове: подчёркивание Postgres ждёт паузы набора, как и красный тон панели
  const typing = useTypingError(traceError?.code);
  const activeClause = useEditorStore((s) => s.activeClause);
  const schema = useBoardStore((s) => s.schema);
  const viewRef = useRef<EditorView | null>(null);

  // onApply меняется каждый рендер панели: замыкаем через ref, чтобы extensions не пересоздавались
  const applyRef = useRef(onApply);
  applyRef.current = onApply;

  const hoverExtension = useMemo(
    () =>
      hoverTooltip((view, pos) => {
        const docText = view.state.doc.toString();
        const ctx = columnContextAt(docText, pos);
        if (!ctx) return null;
        const resolvedCol = resolveColumn(ctx.column, ctx.tables, schema);
        if (!resolvedCol) return null;
        return {
          pos: ctx.column.from,
          end: ctx.column.to,
          above: true,
          create() {
            // подсветка на доске (и в призраке, когда он появится в Ф6)
            useEditorStore.getState().setHoveredColumn(resolvedCol.id);
            const dom = document.createElement('div');
            dom.className = 'rounded-md border bg-popover px-2 py-1 text-xs font-mono shadow-sm';
            dom.textContent = `${resolvedCol.id} : ${resolvedCol.type}`;
            return {
              dom,
              destroy: () => useEditorStore.getState().setHoveredColumn(null),
            };
          },
        };
      }),
    [schema],
  );

  const extensions = useMemo(
    () => [
      sql({
        dialect: PostgreSQL,
        upperCaseKeywords: false,
        schema: schema ? buildSchemaSpec(schema) : undefined,
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'SQL-запрос' }),
      // Prec.highest: иначе Mod-Enter из defaultKeymap (insertBlankLine) срабатывает раньше
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              applyRef.current?.();
              return true;
            },
          },
        ]),
      ),
      editorTheme(),
      clauseHighlight(),
      hoverExtension,
      ...extraExtensions,
    ],
    [schema, hoverExtension, extraExtensions],
  );

  // Программные диагностики: setDiagnostics сам подключает lint-состояние, linter не нужен
  // (пустой linter через 750 мс затирал бы диагностики)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diags: Diagnostic[] = [];
    if (parseError) {
      const d = parseDiagnostic(view.state.doc.toString(), parseError);
      diags.push({ ...d, severity: 'error', source: 'SQL' });
    }
    if (traceError && traceSql && !typing) {
      const d = pgDiagnostic(view.state.doc.toString(), traceSql, traceError);
      if (d) diags.push({ ...d, severity: 'error', source: 'PostgreSQL' });
    }
    view.dispatch(setDiagnostics(view.state, diags));
  }, [parseError, traceError, traceSql, typing]);

  // Подсветка активного клауза в редакторе
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let range: { from: number; to: number } | null = null;
    if (activeClause) {
      const parsed = parseSql(text);
      if (parsed.ok) {
        const stmt = statementAt(parsed.statements, useEditorStore.getState().cursor);
        const found = stmt ? clauseRanges(stmt).find((r) => r.clause === activeClause) : undefined;
        if (found) range = { from: found.from, to: Math.min(found.to, view.state.doc.length) };
      }
    }
    view.dispatch({ effects: setActiveClauseRange.of(range) });
  }, [activeClause, text]);

  return (
    <CodeMirror
      ref={ref}
      value={text}
      theme="none"
      // корень на всю панель: .cm-editor высотой с панель, рамка фокуса обводит всё поле
      className="h-full"
      height="100%"
      indentWithTab={false}
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
