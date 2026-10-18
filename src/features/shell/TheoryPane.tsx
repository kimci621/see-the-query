import { Menu } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LessonView } from '@/features/lessons/LessonView';
import { LESSONS } from '@/features/lessons/registry';
import type { LessonMeta } from '@/features/lessons/types';

export function TheoryPane({
  meta,
  onOpenLessons,
}: {
  meta: LessonMeta | undefined;
  // Есть только когда сайдбар скрыт: кнопка открывает список уроков в Sheet
  onOpenLessons?: () => void;
}) {
  return (
    // Radix кладёт содержимое в display: table, и оно растёт по самой широкой строке (код, длинное слово).
    // Блок держит теорию в ширине колонки: при 200% текста заголовок переносится, код скроллится внутри
    <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
      {onOpenLessons && (
        <div className="px-8 pt-4">
          <Button id="lessons-button" variant="outline" size="sm" onClick={onOpenLessons}>
            <Menu className="size-4" aria-hidden /> Уроки
          </Button>
        </div>
      )}
      <article className="prose prose-neutral max-w-none px-8 py-6 break-words dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        {meta ? (
          <LessonView key={meta.id} meta={meta} />
        ) : (
          <div className="not-prose space-y-2">
            <h1 className="text-xl font-semibold">Урок не найден</h1>
            <p className="text-muted-foreground">Ссылка устарела или в ней опечатка.</p>
            {LESSONS[0] && (
              <Link className="underline" to={`/l/${LESSONS[0].id}`}>
                К первому уроку
              </Link>
            )}
          </div>
        )}
      </article>
    </ScrollArea>
  );
}
