import { Ban, ExternalLink, Info, Lightbulb, ListChecks, Rocket, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

export type CalloutKind = 'analogy' | 'trap' | 'tip' | 'note';

const KINDS = {
  analogy: {
    title: 'Аналогия',
    Icon: Lightbulb,
    tone: 'border-border bg-muted/40',
    iconTone: 'text-muted-foreground',
  },
  trap: {
    title: 'Ловушка',
    Icon: TriangleAlert,
    tone: 'border-changed bg-changed-bg',
    iconTone: 'text-changed',
  },
  tip: { title: 'В продакшене', Icon: Rocket, tone: 'border-kept bg-kept-bg', iconTone: 'text-kept' },
  note: {
    title: 'Заметка',
    Icon: Info,
    tone: 'border-border bg-muted/40',
    iconTone: 'text-muted-foreground',
  },
} as const;

export const CALLOUT_KINDS = Object.keys(KINDS) as CalloutKind[];

// Внешняя ссылка урока: новая вкладка, иконка для глаз и пометка для читалки
export function NewTabLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink aria-hidden className="inline size-3.5 align-baseline" />
      <span className="sr-only">(откроется в новой вкладке)</span>
    </a>
  );
}

export function TlDr({ children }: { children: ReactNode }) {
  return (
    <div className="text-lg italic text-muted-foreground">
      <span className="sr-only">Коротко:</span> {children}
    </div>
  );
}

export function Callout({ kind, children }: { kind: CalloutKind; children: ReactNode }) {
  const { title, Icon, tone, iconTone } = KINDS[kind];
  return (
    <aside role="note" aria-label={title} className={cn('my-6 rounded-md border-l-4 px-4 py-1', tone)}>
      <p className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden className={cn('size-4', iconTone)} />
        {title}
      </p>
      {children}
    </aside>
  );
}

export function DontDoThis({ href, children }: { href: string; children: ReactNode }) {
  return (
    <aside
      role="note"
      aria-label="Don't Do This"
      className="my-6 rounded-md border-l-4 border-destructive bg-destructive/10 px-4 py-1"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Ban aria-hidden className="size-4 text-destructive" />
        Don't Do This
      </p>
      {children}
      <p>
        <NewTabLink href={href}>PostgreSQL wiki: Don't Do This</NewTabLink>
      </p>
    </aside>
  );
}

export function Cheatsheet({ children }: { children: ReactNode }) {
  // id на экземпляр: две шпаргалки на странице не делят подпись
  const title = useId();
  return (
    <section aria-labelledby={title} className="my-8 rounded-md border px-4 py-1">
      <h2 id={title} className="flex items-center gap-2">
        <ListChecks aria-hidden className="size-5" />
        Шпаргалка
      </h2>
      {children}
    </section>
  );
}
