import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useSandbox } from '@/features/db/SandboxProvider';
import { type BTreeSceneData, loadBTreeScene } from '@/features/scenes/btree-scene';
import { useStepper } from '@/features/scenes/useStepper';
import { initParser } from '@/features/sql/parser';
import { rowsRead } from '@/features/tracer/explain';

type SceneState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: BTreeSceneData };
const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function BTreeScene({
  table,
  index,
  column,
  value,
}: {
  table: string;
  index: string;
  column: string;
  value: number | string;
}) {
  const { sandbox, status } = useSandbox();
  const [state, setState] = useState<SceneState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      sandbox?.subscribe((event) => {
        if (event.type === 'changed') setRevision((current) => current + 1);
      }),
    [sandbox],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision перезагружает данные после изменения базы
  useEffect(() => {
    if (!sandbox || status !== 'ready') {
      setState({ status: 'loading' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState({ status: 'loading' });
    void initParser()
      .then(() =>
        sandbox.preview(
          (db) =>
            loadBTreeScene(
              db,
              table,
              index,
              column,
              typeof value === 'string' && !value.trim() ? NaN : Number(value),
            ),
          controller.signal,
        ),
      )
      .then(
        (data) => {
          if (active) setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (active)
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [sandbox, status, table, index, column, value, revision]);
  if (state.status === 'loading')
    return (
      <p role="status" className="my-6 text-sm text-muted-foreground">
        Читаем страницы индекса...
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert" className="not-prose my-6 rounded-lg border p-4 text-sm">
        <p>Не удалось подготовить B-дерево: {state.message}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setRevision((current) => current + 1)}
        >
          Повторить
        </Button>
      </div>
    );
  return <BTreePlayer data={state.data} value={Number(value)} />;
}

function BTreePlayer({ data, value }: { data: BTreeSceneData; value: number }) {
  const { index, next, prev } = useStepper(4);
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  const go = (direction: 'next' | 'prev') => {
    if ((direction === 'prev' && index === 0) || (direction === 'next' && index === 3)) return;
    flushSync(() => (direction === 'next' ? next() : prev()));
    if (direction === 'next' && index === 2) back.current?.focus();
    else if (direction === 'prev' && index === 1) forward.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    go(event.key === 'ArrowRight' ? 'next' : 'prev');
  };
  const titles = [
    'Страницы таблицы',
    'Последовательное чтение',
    'Корень и листья B-дерева',
    'Поиск по индексу',
  ];
  const leaves = data.index.rootItems.map((item) => Number(/^\((\d+),\d+\)$/.exec(item.ctid)?.[1]));
  const target = data.targetLeaf ?? data.initialLeaf;
  const seqRead = rowsRead(data.seqPlan);
  const indexRead = rowsRead(data.indexPlan);
  const bufferAccess = (data.indexPlan.sharedHitBlocks ?? 0) + (data.indexPlan.sharedReadBlocks ?? 0);
  return (
    <section
      aria-label="Поиск в B-дереве"
      onKeyDown={onKeyDown}
      className="not-prose my-6 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Страницы PostgreSQL
          </p>
          <h3 className="mt-1 text-sm font-semibold">{titles[index]}</h3>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          Шаг {index + 1} из 4<span className="sr-only">: {titles[index]}</span>
        </span>
      </div>
      {index < 2 ? (
        <>
          <p className="mt-3 text-sm">
            {fmt.format(data.tableRows)} строк в таблице, {fmt.format(data.heapPages)} страниц данных.
          </p>
          <PageGrid count={data.heapPages} highlight={index === 1} />
          {index === 1 && (
            <p className="mt-3 text-sm">
              Принудительный {data.seqPlan.nodeType}: просмотрено{' '}
              {seqRead === null ? 'неизвестно' : fmt.format(seqRead)} строк, возвращено{' '}
              {fmt.format((data.seqPlan.actualRows ?? 0) * (data.seqPlan.loops ?? 0))}.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm">
            Корень: страница {data.index.rootPage}, уровней: {data.index.level + 1}, переходов к листьям:{' '}
            {fmt.format(leaves.length)}.
          </p>
          <TreeGrid leaves={leaves} selected={index === 3 ? target : null} rootPage={data.index.rootPage} />
          {index === 3 && (
            <div className="mt-3 space-y-2 text-sm">
              <section aria-label="Путь поиска" className="flex flex-wrap items-center gap-1 text-xs">
                <span className="rounded border bg-muted/30 px-2 py-1">Ключ {value}</span>
                <span aria-hidden>→</span>
                <span className="rounded border bg-muted/30 px-2 py-1">Корень {data.index.rootPage}</span>
                <span aria-hidden>→</span>
                <span className="rounded border bg-muted/30 px-2 py-1">Лист {data.initialLeaf}</span>
                {data.targetLeaf !== null && data.targetLeaf !== data.initialLeaf && (
                  <>
                    <span aria-hidden>→</span>
                    <span className="rounded border bg-muted/30 px-2 py-1">Лист {data.targetLeaf}</span>
                  </>
                )}
                {data.heapCtid && data.targetLeaf !== null && (
                  <>
                    <span aria-hidden>→</span>
                    <span className="rounded border bg-muted/30 px-2 py-1">Таблица {data.heapCtid}</span>
                  </>
                )}
              </section>
              <p>
                Ключ {value}: сначала лист {data.initialLeaf}
                {data.targetLeaf !== null && data.targetLeaf !== data.initialLeaf
                  ? `, затем соседний лист ${data.targetLeaf}`
                  : ''}
                .
              </p>
              {data.heapCtid && data.targetLeaf !== null ? (
                <p>
                  Найдена запись индекса, адрес версии в таблице: <code>{data.heapCtid}</code>.
                </p>
              ) : (
                <p>Физическую запись ключа не удалось подтвердить на проверенных листах.</p>
              )}
              <p>
                План по умолчанию: {data.indexPlan.nodeType}
                {indexRead === null ? '' : `, строк просмотрено: ${fmt.format(indexRead)}`}; обращений к общим
                буферам: {fmt.format(bufferAccess)}.
              </p>
              <p className="text-xs text-muted-foreground">
                Буферы считают обращения, включая повторные, а не число разных страниц.
              </p>
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          Назад
        </Button>
        <Button ref={forward} size="sm" disabled={index === 3} onClick={() => go('next')}>
          Дальше
        </Button>
      </div>
    </section>
  );
}

function PageGrid({ count, highlight }: { count: number; highlight: boolean }) {
  // ponytail: показываем до 1000 страниц; для больших таблиц нужна группировка по диапазонам.
  const pages = Array.from({ length: Math.min(count, 1000) }, (_, i) => i + 1);
  return (
    <div className="mt-3 rounded-md border p-2">
      <div
        aria-label={`Показано страниц: ${pages.length} из ${count}`}
        role="img"
        className="relative grid grid-cols-[repeat(50,minmax(0,1fr))] gap-0.5"
      >
        {pages.map((page) => (
          <span
            key={page}
            aria-hidden
            className={`aspect-square rounded-[1px] ${highlight ? 'bg-primary/70' : 'bg-muted-foreground/30'}`}
          />
        ))}
        {highlight && pages.length > 0 && (
          <span
            aria-hidden
            className="btree-scanner"
            style={{ '--btree-rows': Math.ceil(pages.length / 50) } as CSSProperties}
          />
        )}
      </div>
      {count > pages.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Показаны первые {fmt.format(pages.length)} страниц из {fmt.format(count)}.
        </p>
      )}
    </div>
  );
}

function TreeGrid({
  leaves,
  selected,
  rootPage,
}: {
  leaves: number[];
  selected: number | null;
  rootPage: number;
}) {
  return (
    <div
      role="img"
      aria-label={`Корень ${rootPage}, листьев ${leaves.length}${selected === null ? '' : `, выбран лист ${selected}`}`}
      className="mt-3 rounded-md border bg-muted/20 p-3"
    >
      <div className="mx-auto w-fit rounded border bg-background px-3 py-1 text-center text-xs font-medium">
        Корень {rootPage}
      </div>
      <div aria-hidden className="mx-auto h-3 w-px bg-border" />
      <div aria-hidden className="flex flex-wrap justify-center gap-0.5">
        {leaves.map((page) => (
          <span
            key={page}
            className={`size-2 rounded-[1px] ${page === selected ? 'bg-primary ring-2 ring-primary/40' : 'bg-muted-foreground/30'}`}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Каждый квадрат - ссылка корня на лист{selected === null ? '' : `; выделен лист ${selected}`}.
      </p>
    </div>
  );
}
