import { Link } from 'react-router';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LessonView } from '@/features/lessons/LessonView';
import { LESSONS } from '@/features/lessons/registry';
import type { LessonMeta } from '@/features/lessons/types';

export function TheoryPane({ meta }: { meta: LessonMeta | undefined }) {
  return (
    <ScrollArea className="h-full">
      <article className="prose prose-neutral max-w-none px-8 py-6 dark:prose-invert">
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
