import { type KeyboardEvent, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useStepper } from '@/features/scenes/useStepper';
import { cn } from '@/lib/utils';
import { buildTimeline, visibleSnapshot } from './timeline';
import type { Scenario, ScenarioStep } from './types';

function resultOf(step: ScenarioStep): string | null {
  if (step.expectError) return `Ошибка ${step.expectError}`;
  if (!step.expect?.rows) return null;
  if (step.expect.rows.length === 0) return 'Нет строк';
  return step.expect.rows
    .map((row) => row.map((value) => (value === null ? 'NULL' : String(value))).join(' | '))
    .join('; ');
}

export function TwoSessions({ scenario }: { scenario: Scenario }) {
  const { index, next, prev } = useStepper(scenario.steps.length);
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  if (scenario.steps.length === 0) return null;
  const frames = buildTimeline(scenario, index);
  const notes = visibleSnapshot(scenario, index);
  const go = (direction: 'next' | 'prev') => {
    if (
      (direction === 'prev' && index === 0) ||
      (direction === 'next' && index === scenario.steps.length - 1)
    )
      return;
    flushSync(() => (direction === 'next' ? next() : prev()));
    if (direction === 'next' && index === scenario.steps.length - 2) back.current?.focus();
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
      aria-label={scenario.title}
      onKeyDown={onKeyDown}
      className="not-prose my-6 rounded-lg border p-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{scenario.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{scenario.intro}</p>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          Шаг {index + 1} из {scenario.steps.length}
          <span className="sr-only">: {scenario.steps[index].caption}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {(['a', 'b'] as const).map((session) => (
          <section key={session} aria-label={`Сессия ${session.toUpperCase()}`} className="min-w-0">
            <h4 className="mb-2 text-xs font-semibold">Сессия {session.toUpperCase()}</h4>
            <ol className="space-y-2">
              {frames
                .filter((frame) => frame.session === session)
                .map((frame) => {
                  const step = scenario.steps[frame.index];
                  const result = frame.state === 'done' ? resultOf(step) : null;
                  return (
                    <li
                      key={frame.index}
                      data-step={frame.index}
                      data-state={frame.state}
                      className={cn(
                        'min-w-0 rounded-md border px-2 py-2',
                        frame.index === index && 'border-primary ring-1 ring-primary/30',
                        frame.state === 'running' && 'border-amber-500 bg-amber-50 dark:bg-amber-950/20',
                        frame.state === 'pending' && 'bg-muted/20',
                      )}
                    >
                      <p className="text-xs font-medium">
                        <span className="mr-1 text-muted-foreground">{frame.index + 1}.</span>
                        {frame.text}
                      </p>
                      <code className="mt-1 block break-all font-mono text-[0.6875rem] text-muted-foreground">
                        {step.sql}
                      </code>
                      <p
                        className={cn(
                          'mt-1 text-[0.6875rem]',
                          frame.state === 'running'
                            ? 'font-medium text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        {frame.state === 'pending'
                          ? 'Ещё не выполнено'
                          : frame.state === 'running'
                            ? 'Ждёт'
                            : step.expectError
                              ? 'Завершилось ошибкой'
                              : 'Выполнено'}
                      </p>
                      {result && (
                        <p
                          className={cn(
                            'mt-1 break-all font-mono text-xs',
                            step.expectError && 'text-destructive',
                          )}
                        >
                          {result}
                        </p>
                      )}
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
      </div>
      {notes.length > 0 && (
        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2">
          <h4 className="text-xs font-semibold">Что происходит</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          Назад
        </Button>
        <Button
          ref={forward}
          size="sm"
          disabled={index === scenario.steps.length - 1}
          onClick={() => go('next')}
        >
          Дальше
        </Button>
      </div>
    </section>
  );
}
