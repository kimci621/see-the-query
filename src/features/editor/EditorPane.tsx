import { lazy, Suspense, useEffect } from 'react';
import { useParams } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { useSandbox } from '@/features/db/SandboxProvider';
import { getLesson } from '@/features/lessons/registry';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { useSceneStore } from '@/stores/scene';
import './editor.css';
import { useLiveTrace } from './useLiveTrace';

// CodeMirror тяжёлый: грузим лениво, оболочка его не ждёт (спека 5.12)
const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })));

export function EditorPane() {
  const { lessonId } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const text = useEditorStore((s) => s.text);
  const { sandbox } = useSandbox();
  useLiveTrace(sandbox);

  const trace = useSceneStore((s) => s.trace);
  useEffect(() => {
    if (!trace) return;
    const board = useBoardStore.getState();
    board.focus(trace.touched.tableIds);
    board.highlightColumns(trace.touched.columns);
  }, [trace]);

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

  return (
    <div className="editor-pane flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<Skeleton className="m-2 h-32 w-[calc(100%-1rem)]" />}>
          {/* onApply получает реальное применение в задаче 10, пока ⌘⏎ ничего не делает */}
          <SqlEditor onApply={() => undefined} />
        </Suspense>
      </div>
    </div>
  );
}
