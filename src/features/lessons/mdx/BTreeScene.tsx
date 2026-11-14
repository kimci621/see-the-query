import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useSandbox } from '@/features/db/SandboxProvider';
import { type BTreeSceneData, loadBTreeScene } from '@/features/scenes/btree-scene';
import { useStepper } from '@/features/scenes/useStepper';
import { initParser } from '@/features/sql/parser';
import { rowsRead } from '@/features/tracer/explain';
import { useSettingsStore } from '@/stores/settings';

type SceneState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: BTreeSceneData };

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
  const locale = useSettingsStore((s) => s.locale);
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
              locale,
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
  }, [sandbox, status, table, index, column, value, revision, locale]);
  if (state.status === 'loading')
    return (
      <p role="status" className="my-6 text-sm text-muted-foreground">
        {locale === 'en' ? 'Reading index pages...' : 'Читаем страницы индекса...'}
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert" className="not-prose my-6 rounded-lg border p-4 text-sm">
        <p>
          {locale === 'en' ? 'Could not prepare the B-tree' : 'Не удалось подготовить B-дерево'}:{' '}
          {state.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setRevision((current) => current + 1)}
        >
          {locale === 'en' ? 'Retry' : 'Повторить'}
        </Button>
      </div>
    );
  return <BTreePlayer data={state.data} value={Number(value)} />;
}

export function BTreePlayer({ data, value }: { data: BTreeSceneData; value: number }) {
  const locale = useSettingsStore((s) => s.locale);
  const fmt = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 });
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
  const titles =
    locale === 'en'
      ? ['Table pages', 'Sequential scan', 'B-tree root and leaves', 'Index search']
      : ['Страницы таблицы', 'Последовательное чтение', 'Корень и листья B-дерева', 'Поиск по индексу'];
  const leaves = data.index.rootItems.map((item) => Number(/^\((\d+),\d+\)$/.exec(item.ctid)?.[1]));
  const target = data.targetLeaf ?? data.initialLeaf;
  const seqRead = rowsRead(data.seqPlan);
  const indexRead = rowsRead(data.indexPlan);
  const bufferAccess = (data.indexPlan.sharedHitBlocks ?? 0) + (data.indexPlan.sharedReadBlocks ?? 0);
  return (
    <section
      aria-label={locale === 'en' ? 'B-tree search' : 'Поиск в B-дереве'}
      onKeyDown={onKeyDown}
      className="not-prose my-6 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {locale === 'en' ? 'PostgreSQL pages' : 'Страницы PostgreSQL'}
          </p>
          <h3 className="mt-1 text-sm font-semibold">{titles[index]}</h3>
        </div>
        <span role="status" className="text-xs text-muted-foreground">
          {locale === 'en' ? `Step ${index + 1} of 4` : `Шаг ${index + 1} из 4`}
          <span className="sr-only">: {titles[index]}</span>
        </span>
      </div>
      {index < 2 ? (
        <>
          <p className="mt-3 text-sm">
            {locale === 'en'
              ? `${fmt.format(data.tableRows)} rows in the table, ${fmt.format(data.heapPages)} data pages.`
              : `${fmt.format(data.tableRows)} строк в таблице, ${fmt.format(data.heapPages)} страниц данных.`}
          </p>
          <PageGrid count={data.heapPages} highlight={index === 1} />
          {index === 1 && (
            <p className="mt-3 text-sm">
              {locale === 'en' ? 'Forced' : 'Принудительный'} {data.seqPlan.nodeType}:{' '}
              {locale === 'en' ? 'rows read' : 'просмотрено'}{' '}
              {seqRead === null ? (locale === 'en' ? 'unknown' : 'неизвестно') : fmt.format(seqRead)}
              {locale === 'en' ? ', returned ' : ' строк, возвращено '}
              {fmt.format((data.seqPlan.actualRows ?? 0) * (data.seqPlan.loops ?? 0))}.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm">
            {locale === 'en' ? 'Root: page' : 'Корень: страница'} {data.index.rootPage},{' '}
            {locale === 'en' ? 'levels' : 'уровней'}: {data.index.level + 1},{' '}
            {locale === 'en' ? 'leaf links' : 'переходов к листьям'}: {fmt.format(leaves.length)}.
          </p>
          <TreeGrid leaves={leaves} selected={index === 3 ? target : null} rootPage={data.index.rootPage} />
          {index === 3 && (
            <div className="mt-3 space-y-2 text-sm">
              <section
                aria-label={locale === 'en' ? 'Search path' : 'Путь поиска'}
                className="flex flex-wrap items-center gap-1 text-xs"
              >
                <span className="rounded border bg-muted/30 px-2 py-1">
                  {locale === 'en' ? 'Key' : 'Ключ'} {value}
                </span>
                <span aria-hidden>→</span>
                <span className="rounded border bg-muted/30 px-2 py-1">
                  {locale === 'en' ? 'Root' : 'Корень'} {data.index.rootPage}
                </span>
                <span aria-hidden>→</span>
                <span className="rounded border bg-muted/30 px-2 py-1">
                  {locale === 'en' ? 'Leaf' : 'Лист'} {data.initialLeaf}
                </span>
                {data.targetLeaf !== null && data.targetLeaf !== data.initialLeaf && (
                  <>
                    <span aria-hidden>→</span>
                    <span className="rounded border bg-muted/30 px-2 py-1">
                      {locale === 'en' ? 'Leaf' : 'Лист'} {data.targetLeaf}
                    </span>
                  </>
                )}
                {data.heapCtid && data.targetLeaf !== null && (
                  <>
                    <span aria-hidden>→</span>
                    <span className="rounded border bg-muted/30 px-2 py-1">
                      {locale === 'en' ? 'Table' : 'Таблица'} {data.heapCtid}
                    </span>
                  </>
                )}
              </section>
              <p>
                {locale === 'en' ? 'Key' : 'Ключ'} {value}: {locale === 'en' ? 'first leaf' : 'сначала лист'}{' '}
                {data.initialLeaf}
                {data.targetLeaf !== null && data.targetLeaf !== data.initialLeaf
                  ? locale === 'en'
                    ? `, then neighboring leaf ${data.targetLeaf}`
                    : `, затем соседний лист ${data.targetLeaf}`
                  : ''}
                .
              </p>
              {data.heapCtid && data.targetLeaf !== null ? (
                <p>
                  {locale === 'en'
                    ? 'Index entry found, table version address'
                    : 'Найдена запись индекса, адрес версии в таблице'}
                  : <code>{data.heapCtid}</code>.
                </p>
              ) : (
                <p>
                  {locale === 'en'
                    ? 'The physical key entry could not be confirmed on the checked leaves.'
                    : 'Физическую запись ключа не удалось подтвердить на проверенных листах.'}
                </p>
              )}
              <p>
                {locale === 'en' ? 'Default plan' : 'План по умолчанию'}: {data.indexPlan.nodeType}
                {indexRead === null
                  ? ''
                  : `, ${locale === 'en' ? 'rows read' : 'строк просмотрено'}: ${fmt.format(indexRead)}`}
                ; {locale === 'en' ? 'shared buffer accesses' : 'обращений к общим буферам'}:{' '}
                {fmt.format(bufferAccess)}.
              </p>
              <p className="text-xs text-muted-foreground">
                {locale === 'en'
                  ? 'Buffer counts include repeated accesses, not distinct pages.'
                  : 'Буферы считают обращения, включая повторные, а не число разных страниц.'}
              </p>
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          {locale === 'en' ? 'Back' : 'Назад'}
        </Button>
        <Button ref={forward} size="sm" disabled={index === 3} onClick={() => go('next')}>
          {locale === 'en' ? 'Next' : 'Дальше'}
        </Button>
      </div>
    </section>
  );
}

function PageGrid({ count, highlight }: { count: number; highlight: boolean }) {
  const locale = useSettingsStore((s) => s.locale);
  const fmt = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 });
  // ponytail: показываем до 1000 страниц; для больших таблиц нужна группировка по диапазонам.
  const pages = Array.from({ length: Math.min(count, 1000) }, (_, i) => i + 1);
  return (
    <div className="mt-3 rounded-md border p-2">
      <div
        aria-label={
          locale === 'en'
            ? `Pages shown: ${pages.length} of ${count}`
            : `Показано страниц: ${pages.length} из ${count}`
        }
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
          {locale === 'en'
            ? `Showing the first ${fmt.format(pages.length)} of ${fmt.format(count)} pages.`
            : `Показаны первые ${fmt.format(pages.length)} страниц из ${fmt.format(count)}.`}
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
  const locale = useSettingsStore((s) => s.locale);
  return (
    <div
      role="img"
      aria-label={
        locale === 'en'
          ? `Root ${rootPage}, ${leaves.length} leaves${selected === null ? '' : `, leaf ${selected} selected`}`
          : `Корень ${rootPage}, листьев ${leaves.length}${selected === null ? '' : `, выбран лист ${selected}`}`
      }
      className="mt-3 rounded-md border bg-muted/20 p-3"
    >
      <div className="mx-auto w-fit rounded border bg-background px-3 py-1 text-center text-xs font-medium">
        {locale === 'en' ? 'Root' : 'Корень'} {rootPage}
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
        {locale === 'en'
          ? `Each square is a root link to a leaf${selected === null ? '' : `; leaf ${selected} is highlighted`}.`
          : `Каждый квадрат - ссылка корня на лист${selected === null ? '' : `; выделен лист ${selected}`}.`}
      </p>
    </div>
  );
}
