import { lazy, Suspense, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useSandbox } from '@/features/db/SandboxProvider';
import { DbException } from '@/features/db/types';
import { getLesson } from '@/features/lessons/registry';
import { clauseAt } from '@/features/sql/clauses';
import { parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { useSceneStore } from '@/stores/scene';
import { EditorToolbar } from './EditorToolbar';
import './editor.css';
import { touchedOf } from './touched';
import { useLiveTrace } from './useLiveTrace';

// CodeMirror тяжёлый: грузим лениво, оболочка его не ждёт (спека 5.12)
const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));

export function EditorPane() {
  const { lessonId } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const activeClause = useEditorStore((s) => s.activeClause);
  const hoveredColumn = useEditorStore((s) => s.hoveredColumn);
  const { sandbox } = useSandbox();
  useLiveTrace(sandbox);

  const trace = useSceneStore((s) => s.trace);

  // Фокус таблиц по трейсу
  useEffect(() => {
    if (!trace) return;
    useBoardStore.getState().focus(trace.touched.tableIds);
  }, [trace]);

  // Подсветка колонок: hover имеет приоритет, иначе колонки последнего трейса
  useEffect(() => {
    const columns = hoveredColumn ? [hoveredColumn] : (trace?.touched.columns ?? []);
    useBoardStore.getState().highlightColumns(columns);
  }, [hoveredColumn, trace]);

  // activeClause при изменении текста или курсора
  useEffect(() => {
    if (text.trim() === '') {
      useEditorStore.getState().setActiveClause(null);
      return;
    }
    const parsed = parseSql(text);
    if (!parsed.ok) {
      useEditorStore.getState().setActiveClause(null);
      return;
    }
    const stmt = statementAt(parsed.statements, cursor);
    useEditorStore.getState().setActiveClause(stmt ? clauseAt(stmt, cursor) : null);
  }, [text, cursor]);

  // activeClause=from/into/using фокусирует таблицы оператора на доске
  useEffect(() => {
    if (activeClause !== 'from' && activeClause !== 'into' && activeClause !== 'using') return;
    const parsed = parseSql(text);
    if (!parsed.ok) return;
    const stmt = statementAt(parsed.statements, cursor);
    if (!stmt) return;
    useBoardStore.getState().focus(touchedOf(stmt, useBoardStore.getState().schema).tableIds);
  }, [activeClause, cursor, text]);

  // Открытие урока: initialQuery из мета или последний запрос ученика
  useEffect(() => {
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.lastQuery : undefined;
    const initial = meta?.initialQuery ?? saved ?? '';
    const editor = useEditorStore.getState();
    if (editor.text !== initial) {
      editor.setText(initial);
      editor.setCursor(initial.length);
    }
  }, [lessonId, meta]);

  // Последний запрос урока: сохраняем через секунду после того, как ученик перестал печатать
  useEffect(() => {
    if (!lessonId) return;
    const timer = setTimeout(() => useLessonStore.getState().setLastQuery(lessonId, text), 1000);
    return () => clearTimeout(timer);
  }, [text, lessonId]);

  // единый путь применения для кнопки, ⌘⏎ из keymap CodeMirror и ⌘⏎ вне редактора
  const applyCurrent = () => {
    if (!sandbox) return;
    const editor = useEditorStore.getState();
    const parsed = parseSql(editor.text);
    if (!parsed.ok) return;
    const stmt = statementAt(parsed.statements, editor.cursor);
    if (!stmt) return;
    void sandbox.apply(stmt.text).catch((e: unknown) => {
      const message = e instanceof DbException ? e.db.message : String(e);
      toast.error('Не получилось', { description: message });
    });
  };

  const applyRef = useRef(applyCurrent);
  applyRef.current = applyCurrent;

  // Глобальные горячие клавиши ⌘Z (вне редактора) и ⌘⏎
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') {
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.closest('.cm-editor')) return; // внутри редактора - undo набора
        e.preventDefault();
        void sandbox?.undo().catch((err: unknown) => {
          const message = err instanceof DbException ? err.db.message : String(err);
          toast.error('Не получилось', { description: message });
        });
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'Enter') {
        e.preventDefault();
        applyRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sandbox]);

  return (
    <div className="editor-pane flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<Skeleton className="m-2 h-32 w-[calc(100%-1rem)]" />}>
          <SqlEditor onApply={applyCurrent} />
        </Suspense>
      </div>
      <EditorToolbar sandbox={sandbox} onApplyCurrent={applyCurrent} />
    </div>
  );
}
