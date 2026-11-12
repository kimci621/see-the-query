import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { formatCell } from '@/features/board/format';
import { useSandbox } from '@/features/db/SandboxProvider';
import { DbException } from '@/features/db/types';
import { MiniTable } from '@/features/scenes/MiniTable';
import {
  loadSplitScene,
  type SplitConfig,
  type SplitSceneData,
  SplitSourceMissingError,
} from '@/features/scenes/split';
import { useStepper } from '@/features/scenes/useStepper';

type LoadState =
  | { status: 'loading' }
  | { status: 'waiting' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SplitSceneData };

export function SplitScene({ source, keyColumn, extract, target, parentColumn, valueColumn }: SplitConfig) {
  const { sandbox, status } = useSandbox();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      sandbox?.subscribe((event) => {
        if (event.type === 'changed') setRevision((current) => current + 1);
      }),
    [sandbox],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision перезагружает сцену после изменения базы
  useEffect(() => {
    if (!sandbox || status !== 'ready') {
      setState({ status: 'loading' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState({ status: 'loading' });
    void sandbox
      .preview(
        (db) => loadSplitScene(db, { source, keyColumn, extract, target, parentColumn, valueColumn }),
        controller.signal,
      )
      .then(
        (data) => {
          if (active) setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (!active) return;
          if (
            error instanceof SplitSourceMissingError ||
            (error instanceof DbException && ['42P01', '42703'].includes(error.db.code))
          ) {
            setState({ status: 'waiting' });
          } else {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [sandbox, status, source, keyColumn, extract, target, parentColumn, valueColumn, revision]);
  if (state.status === 'loading')
    return <p className="my-6 text-sm text-muted-foreground">Готовим сцену...</p>;
  if (state.status === 'waiting')
    return (
      <p role="status" className="my-6 rounded-lg border p-4 text-sm text-muted-foreground">
        Для сцены нужна исходная таблица {source} с колонками {keyColumn} и {extract}. Создай её по примеру
        выше; после удаления исходной колонки верни данные через «Сброс» и повтори подготовку.
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert" className="not-prose my-6 rounded-lg border p-4 text-sm">
        <p>Не удалось подготовить сцену: {state.message}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setRevision((value) => value + 1)}
        >
          Повторить
        </Button>
      </div>
    );
  return <SplitPlayer data={state.data} keyColumn={keyColumn} />;
}

type Line = { key: string; path: string };

export function SplitPlayer({ data, keyColumn }: { data: SplitSceneData; keyColumn: string }) {
  const { index, next, prev } = useStepper(data.frames.length);
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const frame = data.frames[index];
  useLayoutEffect(() => {
    if (!frame.right || !area.current || !left.current || !right.current) {
      setLines([]);
      return;
    }
    const container = area.current;
    const leftTable = left.current;
    const rightTable = right.current;
    const update = () => {
      const bounds = container.getBoundingClientRect();
      const leftRows = leftTable.querySelectorAll('tbody tr');
      const rightRows = rightTable.querySelectorAll('tbody tr');
      const keyIndex = frame.left.columns.indexOf(keyColumn);
      const positions = new Map(frame.left.rows.map((row, i) => [String(row.values[keyIndex]), i]));
      const nextLines = frame.right?.rows.flatMap((row, i) => {
        const sourceIndex = positions.get(String(row.values[0]));
        const from = sourceIndex === undefined ? null : leftRows[sourceIndex]?.getBoundingClientRect();
        const to = rightRows[i]?.getBoundingClientRect();
        if (!from || !to || from.width === 0 || to.width === 0) return [];
        const x1 = from.right - bounds.left;
        const y1 = from.top + from.height / 2 - bounds.top;
        const x2 = to.left - bounds.left;
        const y2 = to.top + to.height / 2 - bounds.top;
        if (x2 <= x1) return [];
        const middle = (x1 + x2) / 2;
        return [{ key: row.key, path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}` }];
      });
      setLines(nextLines ?? []);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container);
    observer?.observe(leftTable);
    observer?.observe(rightTable);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [frame, keyColumn]);
  const go = (direction: 'next' | 'prev') => {
    if ((direction === 'prev' && index === 0) || (direction === 'next' && index === data.frames.length - 1))
      return;
    flushSync(() => (direction === 'next' ? next() : prev()));
    if (direction === 'next' && index === data.frames.length - 2) back.current?.focus();
    else if (direction === 'prev' && index === 1) forward.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    go(event.key === 'ArrowRight' ? 'next' : 'prev');
  };
  const cells = (rows: typeof frame.left.rows) =>
    rows.map((row) => ({ key: row.key, cells: row.values.map((value) => formatCell(value).text) }));
  return (
    <section
      aria-label="Разделение таблицы"
      onKeyDown={onKeyDown}
      className="@container not-prose my-6 rounded-lg border p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{frame.caption}</p>
        <span role="status" className="text-xs text-muted-foreground">
          Шаг {index + 1} из {data.frames.length}
          <span className="sr-only">: {frame.caption}</span>
        </span>
      </div>
      <div ref={area} className="relative grid gap-10 @2xl:grid-cols-2">
        <div ref={left} className="min-w-0">
          <MiniTable title={frame.left.title} columns={frame.left.columns} rows={cells(frame.left.rows)} />
        </div>
        {frame.right && (
          <div ref={right} className="min-w-0">
            <MiniTable
              title={frame.right.title}
              columns={frame.right.columns}
              rows={cells(frame.right.rows)}
            />
          </div>
        )}
        {frame.right && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible text-primary/60 @2xl:block"
          >
            {lines.map((line) => (
              <path key={line.key} d={line.path} fill="none" stroke="currentColor" strokeWidth="1.5" />
            ))}
          </svg>
        )}
      </div>
      {frame.right && (
        <p className="mt-3 text-xs text-muted-foreground">
          Строки связаны значением ключа в первой колонке правой таблицы. Это проект, он не меняет базу.
        </p>
      )}
      {(data.truncatedParents || data.truncatedValues) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Показана часть данных: не более 15 исходных и 200 полученных строк.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          Назад
        </Button>
        <Button
          ref={forward}
          size="sm"
          disabled={index === data.frames.length - 1}
          onClick={() => go('next')}
        >
          Дальше
        </Button>
      </div>
    </section>
  );
}
