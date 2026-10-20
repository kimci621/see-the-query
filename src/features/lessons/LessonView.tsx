import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { NewTabLink } from './mdx/Callouts';
import { mdxComponents } from './mdx/components';
import { loadLessonContent, neighbours } from './registry';
import type { LessonMeta } from './types';
import { useLessonProgress } from './useLessonProgress';

// Один lazy-компонент на урок, иначе Suspense будет перезагружать урок на каждый рендер
const cache = new Map<string, LazyExoticComponent<ComponentType<{ components?: Record<string, unknown> }>>>();

function lessonComponent(meta: LessonMeta) {
  let component = cache.get(meta.id);
  if (!component) {
    component = lazy(() => loadLessonContent(meta));
    cache.set(meta.id, component);
  }
  return component;
}

function LessonSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Загрузка урока">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function LessonView({ meta }: { meta: LessonMeta }) {
  const [end, setEnd] = useState<HTMLDivElement | null>(null);
  useLessonProgress(meta, end);

  const Content = lessonComponent(meta);
  const { prev, next } = neighbours(meta.id);

  return (
    <>
      <header className="not-prose mb-6">
        <p className="font-mono text-sm text-muted-foreground">{meta.number}</p>
        {/* tabIndex -1: сюда переводим фокус после выбора урока в Sheet */}
        <h1 id="lesson-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          {meta.title}
        </h1>
      </header>
      <Suspense fallback={<LessonSkeleton />}>
        <Content components={mdxComponents} />
        <div ref={setEnd} aria-hidden="true" data-lesson-end />
      </Suspense>
      {meta.docs.length > 0 && (
        <section aria-labelledby="lesson-docs" className="mt-10">
          <h2 id="lesson-docs">Документация PostgreSQL</h2>
          <ul>
            {meta.docs.map(({ url, title }) => (
              <li key={url}>
                <NewTabLink href={url}>{title}</NewTabLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav
        className="not-prose mt-12 flex justify-between gap-4 border-t pt-4 text-sm"
        aria-label="Соседние уроки"
      >
        {prev ? (
          <Link to={`/l/${prev.id}`} className="text-muted-foreground hover:text-foreground">
            ⟨ {prev.number} {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/l/${next.id}`} className="text-right text-muted-foreground hover:text-foreground">
            {next.number} {next.title} ⟩
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}
