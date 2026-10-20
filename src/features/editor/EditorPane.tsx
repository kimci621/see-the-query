import { lazy, Suspense, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { useSandbox } from '@/features/db/SandboxProvider';
import { getLesson } from '@/features/lessons/registry';
import { isTypingTarget } from '@/features/shell/useGlobalHotkeys';
import { clauseAt } from '@/features/sql/clauses';
import { parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { useSceneStore } from '@/stores/scene';
import { applyCurrent, focusDmlTarget } from './applyCurrent';
import { EditorToolbar } from './EditorToolbar';
import './editor.css';
import { notifyDbError, undoLast } from './notifyDbError';
import { touchedOf } from './touched';
import { useLiveTrace } from './useLiveTrace';
import { useParserReady } from './useParsedText';

// CodeMirror тяжёлый: грузим лениво, оболочка его не ждёт (спека 5.12)
const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));

export function EditorPane() {
  const { lessonId } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const activeClause = useEditorStore((s) => s.activeClause);
  const hoveredColumn = useEditorStore((s) => s.hoveredColumn);
  const hasSchema = useBoardStore((s) => s.schema !== null);
  const parserReady = useParserReady();
  const { sandbox } = useSandbox();
  useLiveTrace(sandbox);

  const trace = useSceneStore((s) => s.trace);

  // Подсветка колонок: hover имеет приоритет, иначе колонки последнего трейса
  useEffect(() => {
    const traced = trace?.touched.columns ?? [];
    useBoardStore.getState().highlightColumns(hoveredColumn ? [hoveredColumn] : traced);
  }, [hoveredColumn, trace]);

  // Свёртка таблиц только по колонкам трейса: hover свёрнутой колонки не меняет ширину ноды и не двигает камеру.
  // Звёздочка последнего трейса разворачивает свёрнутые таблицы
  useEffect(() => {
    const board = useBoardStore.getState();
    board.setQueryColumns(trace?.touched.columns ?? []);
    board.expandTables(trace?.touched.expanded ?? []);
  }, [trace]);

  // INSERT/UPDATE/DELETE: камера летит к целевой таблице, строки базовой доски не двигаются.
  // SELECT: фокус и камера на таблицах трейса, если набор сменился (каретка в WHERE и дальше)
  // Пока курсор в from/into/using, фокус ведёт курсор (ниже): трейс его не перебивает
  useEffect(() => {
    const clause = useEditorStore.getState().activeClause;
    if (clause === 'from' || clause === 'into' || clause === 'using') return;
    if (!trace) return;
    if (trace.statementType === 'select') useBoardStore.getState().focus(trace.touched.tableIds);
    else focusDmlTarget(trace.sql);
  }, [trace]);

  // Пометки строк после «Применить» держатся до следующего запроса: любая правка текста их снимает
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is the trigger, not a dependency
  useEffect(() => {
    useBoardStore.getState().clearRowWrites();
  }, [text]);

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

  // Открытие урока: последний запрос ученика важнее initialQuery из мета.
  // Запрос кнопки прошлого урока больше не считается запуском пользователя
  useEffect(() => {
    useSceneStore.getState().setLessonQuery(null);
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.lastQuery : undefined;
    const initial = saved ?? meta?.initialQuery ?? '';
    useSceneStore.getState().setStartQuery(initial);
    const editor = useEditorStore.getState();
    if (editor.text !== initial) {
      editor.setText(initial);
      editor.setCursor(initial.length);
    }
  }, [lessonId, meta]);

  // Стартовый кадр урока: таблицы стартового текста (спека 3.4), свёртка как у будущего трейса,
  // чтобы первый трейс не менял ширину нод. Ждёт схему и парсер; новая схема после «Применить»
  // кадр не повторяет. Нет таблиц или текст не разбирается - кадр на всю доску
  useEffect(() => {
    if (!lessonId || !hasSchema || !parserReady) return;
    const { text, cursor } = useEditorStore.getState();
    const parsed = parseSql(text);
    const stmt = parsed.ok ? statementAt(parsed.statements, cursor) : null;
    const board = useBoardStore.getState();
    const touched = stmt ? touchedOf(stmt, board.schema) : { tableIds: [], columns: [], expanded: [] };
    board.setQueryColumns(touched.columns);
    board.expandTables(touched.expanded);
    board.frameStart(touched.tableIds);
  }, [lessonId, hasSchema, parserReady]);

  // Последний запрос урока: сохраняем через секунду после того, как ученик перестал печатать.
  // Текст, равный initialQuery, не храним (и стираем прежний): иначе новый initialQuery урока до ученика не дойдёт
  useEffect(() => {
    if (!lessonId) return;
    const timer = setTimeout(
      () => useLessonStore.getState().setLastQuery(lessonId, text === meta?.initialQuery ? undefined : text),
      1000,
    );
    return () => clearTimeout(timer);
  }, [text, lessonId, meta]);

  // единый путь применения для кнопки, ⌘⏎ из keymap CodeMirror и ⌘⏎ вне редактора
  const apply = () => {
    if (sandbox) void applyCurrent(sandbox);
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Глобальные горячие клавиши ⌘Z и ⌘⏎. В полях ввода (редактор, поиск) и в диалогах
  // клавиши принадлежат им: в редакторе ⌘Z отменяет набор, ⌘⏎ ловит keymap CodeMirror
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || (e.target instanceof Element && e.target.closest('[role=dialog]')))
        return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (sandbox)
          void undoLast(sandbox).catch((err: unknown) => notifyDbError(err, useEditorStore.getState().text));
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
          <SqlEditor onApply={apply} />
        </Suspense>
      </div>
      <EditorToolbar sandbox={sandbox} onApplyCurrent={apply} />
    </div>
  );
}
