import { useEffect } from 'react';
import { toast } from 'sonner';
import { message } from '@/lib/messages';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';
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
  const locale = useSettingsStore((s) => s.locale);
  useEffect(() => {
    if (!sandbox || !lessonId || !datasetId) return;
    // пока наш loadLesson не завершился, события относятся к прошлому уроку
    let loaded = false;
    let active = true;
    const saveJournal = () => useLessonStore.getState().setJournal(lessonId, [...sandbox.journal()], locale);
    const off = sandbox.subscribe((e) => {
      if (e.type === 'restarted')
        toast.warning(message(useSettingsStore.getState().locale, RESTART_MESSAGES[e.reason]));
      if (e.type === 'changed' && loaded) saveJournal();
    });
    const saved = () => useLessonStore.getState().byId[lessonId]?.workspaces[locale]?.journal ?? [];
    void sandbox.loadLesson(datasetId, saved, locale).then(
      () => {
        if (!active) return;
        loaded = true;
        saveJournal(); // журнал мог обрезаться, если запись больше не выполняется
      },
      () => {
        if (active)
          toast.error(
            message(useSettingsStore.getState().locale, 'Не удалось поднять Postgres. Обнови страницу.'),
          );
      },
    );
    return () => {
      active = false;
      if (!loaded) {
        off();
        return;
      }
      saveJournal();
      void sandbox.whenIdle().then(off);
    };
  }, [sandbox, lessonId, datasetId, locale]);
}
