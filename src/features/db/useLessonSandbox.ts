import { useEffect } from 'react';
import { toast } from 'sonner';
import { useBoardStore } from '@/stores/board';
import { useLessonStore } from '@/stores/lesson';
import type { DatasetId } from './datasets';
import type { Sandbox } from './sandbox';

export const RESTART_MESSAGES = {
  timeout: 'Запрос выполнялся дольше 3 секунд. Песочница перезапущена, твои изменения восстановлены.',
  crash: 'Песочница перезапущена, твои изменения восстановлены.',
} as const;

// Связывает песочницу с текущим уроком: поднимает датасет с сохранённым журналом,
// пишет журнал обратно в localStorage после каждого изменения и показывает тост после перезапуска.
export function useLessonSandbox(
  sandbox: Sandbox | null,
  lessonId: string | undefined,
  datasetId: DatasetId | undefined,
) {
  useEffect(() => {
    if (!sandbox || !lessonId || !datasetId) return;
    // пока наш loadLesson не завершился, события относятся к прошлому уроку
    let loaded = false;
    const saveJournal = () => useLessonStore.getState().setJournal(lessonId, [...sandbox.journal()]);
    const off = sandbox.subscribe((e) => {
      if (e.type === 'restarted') toast.warning(RESTART_MESSAGES[e.reason]);
      if (e.type === 'changed' && loaded) saveJournal();
    });
    // схема прошлого урока не должна попасть в стартовый кадр: он ждёт первую схему этого урока
    useBoardStore.getState().setSchema(null);
    const saved = useLessonStore.getState().byId[lessonId]?.journal ?? [];
    sandbox.loadLesson(datasetId, saved).then(
      () => {
        loaded = true;
        saveJournal(); // журнал мог обрезаться, если запись больше не выполняется
      },
      () => toast.error('Не удалось поднять Postgres. Обнови страницу.'),
    );
    return off;
  }, [sandbox, lessonId, datasetId]);
}
