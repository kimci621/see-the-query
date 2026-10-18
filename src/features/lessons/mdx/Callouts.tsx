import { Ban, Info, Lightbulb, ListChecks, Rocket, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
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
        <a href={href} target="_blank" rel="noreferrer">
          PostgreSQL wiki: Don't Do This
        </a>
      </p>
    </aside>
  );
}

export function Cheatsheet({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="lesson-cheatsheet" className="my-8 rounded-md border px-4 py-1">
      <h2 id="lesson-cheatsheet" className="flex items-center gap-2">
        <ListChecks aria-hidden className="size-5" />
        Шпаргалка
      </h2>
      {children}
    </section>
  );
}
