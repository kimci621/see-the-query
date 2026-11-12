import { LockKeyhole } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createWorkerClient } from '@/features/db/client';
import { classifyVersions, type VersionState } from '@/features/db/pageinspect';
import type { DbClient } from '@/features/db/types';
import { MiniTable } from '@/features/scenes/MiniTable';
import { type MvccStep, runMvccScene } from '@/features/scenes/mvcc-scene';
import { useStepper } from '@/features/scenes/useStepper';

const LABEL: Record<VersionState, string> = {
  live: 'видна',
  dead: 'устарела',
  aborted: 'отменена',
  locked: 'след блокировки',
  unused: 'пусто',
  redirect: '↪ указатель',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; steps: MvccStep[] };

export function MvccPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt запускает повторную попытку
  useEffect(() => {
    let active = true;
    let client: DbClient | null = null;
    setState({ status: 'loading' });
    void (async () => {
      const db = await createWorkerClient();
      if (!active) {
        await db.close();
        return;
      }
      client = db;
      try {
        const steps = await runMvccScene(db);
        if (active) setState({ status: 'ready', steps });
      } finally {
        client = null;
        await db.close();
      }
    })().catch((error: unknown) => {
      if (active)
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
      if (client) void client.close();
    };
  }, [attempt]);

  if (state.status === 'loading')
    return (
      <p role="status" className="my-6 text-sm text-muted-foreground">
        Готовим страницу PostgreSQL...
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert" className="not-prose my-6 rounded-lg border p-4 text-sm">
        <p>Не удалось подготовить сцену: {state.message}</p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Повторить
        </Button>
      </div>
    );
  return <MvccPlayer steps={state.steps} />;
}

function MvccPlayer({ steps }: { steps: MvccStep[] }) {
  const { index, next, prev } = useStepper(steps.length);
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  if (steps.length === 0) return null;
  const step = steps[index];
  const states = new Map(classifyVersions(step.versions, step.facts).map(({ lp, state }) => [lp, state]));
  const go = (direction: 'next' | 'prev') => {
    if ((direction === 'prev' && index === 0) || (direction === 'next' && index === steps.length - 1)) return;
    flushSync(() => (direction === 'next' ? next() : prev()));
    if (direction === 'next' && index === steps.length - 2) back.current?.focus();
    else if (direction === 'prev' && index === 1) forward.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    go(event.key === 'ArrowRight' ? 'next' : 'prev');
  };
  return (
    <section
      aria-label="Версии строк PostgreSQL"
      onKeyDown={onKeyDown}
      className="@container not-prose my-6 rounded-lg border p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Страница PostgreSQL
          </p>
          <p className="mt-1 text-sm font-medium">{step.caption}</p>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          Шаг {index + 1} из {steps.length}
          <span className="sr-only">: {step.caption}</span>
        </span>
      </div>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <MiniTable
          title="Версии на странице"
          columns={['lp', 'xmin', 'xmax', 'ctid', 'состояние']}
          rows={step.versions.map((row) => {
            const state = states.get(row.lp) ?? 'live';
            return {
              key: String(row.lp),
              state,
              cells: [
                row.lp,
                row.lpFlags === 1 ? row.xmin : '-',
                row.lpFlags === 1 ? row.xmax : '-',
                row.ctid ?? '-',
                state === 'locked' ? (
                  <span key="state" className="inline-flex items-center gap-1">
                    <LockKeyhole aria-hidden className="size-3" />
                    {LABEL[state]}
                  </span>
                ) : (
                  LABEL[state]
                ),
              ],
            };
          })}
        />
        <MiniTable
          title="Видит SELECT"
          columns={['id', 'val']}
          rows={step.visible.map((row) => ({ key: row.id, cells: [row.id, row.val] }))}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Статусы относятся к показанному SELECT. Значение 0 в xmax означает, что номер транзакции изменения или
        блокировки не записан.
      </p>
      {index === 4 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Это след проверки внешнего ключа. Транзакция уже завершена, поэтому активной блокировки здесь нет.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          Назад
        </Button>
        <Button ref={forward} size="sm" disabled={index === steps.length - 1} onClick={() => go('next')}>
          Дальше
        </Button>
      </div>
    </section>
  );
}
