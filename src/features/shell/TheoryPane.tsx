import { Menu } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LessonView } from '@/features/lessons/LessonView';
import { LESSONS } from '@/features/lessons/registry';
import type { LessonMeta } from '@/features/lessons/types';
import { useMessages } from '@/hooks/use-messages';
import { lessonHref } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings';

export function TheoryPane({
  meta,
  translationPending = false,
  onOpenLessons,
}: {
  meta: LessonMeta | undefined;
  translationPending?: boolean;
  // Есть только когда сайдбар скрыт: кнопка открывает список уроков в Sheet
  onOpenLessons?: () => void;
}) {
  const locale = useSettingsStore((s) => s.locale);
  const t = useMessages();
  return (
    // Radix кладёт содержимое в display: table, и оно растёт по самой широкой строке (код, длинное слово).
    // Блок держит теорию в ширине колонки: при 200% текста заголовок переносится, код скроллится внутри
    <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
      {onOpenLessons && (
        <div className="px-8 pt-4">
          <Button id="lessons-button" variant="outline" size="sm" onClick={onOpenLessons}>
            <Menu className="size-4" aria-hidden /> {t('Уроки')}
          </Button>
        </div>
      )}
      <article className="prose prose-neutral max-w-none px-8 py-6 break-words dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        {meta ? (
          <LessonView key={meta.id} meta={meta} />
        ) : translationPending ? (
          <div className="not-prose space-y-2">
            <h1 className="text-xl font-semibold">Translation coming soon</h1>
            <p className="text-muted-foreground">This lesson is not available in English yet.</p>
          </div>
        ) : (
          <div className="not-prose space-y-2">
            <h1 className="text-xl font-semibold">{t('Урок не найден')}</h1>
            <p className="text-muted-foreground">{t('Ссылка устарела или в ней опечатка.')}</p>
            {LESSONS[0] && (
              <Link className="underline" to={lessonHref(LESSONS[0].id, locale)}>
                {t('К первому уроку')}
              </Link>
            )}
          </div>
        )}
      </article>
    </ScrollArea>
  );
}
