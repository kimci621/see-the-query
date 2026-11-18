import { Maximize } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BoardCanvas } from '@/features/board/BoardCanvas';
import { BoardStatus } from '@/features/board/BoardStatus';
import { useBoardHotkeys } from '@/features/board/useBoardHotkeys';
import { useSandbox } from '@/features/db/SandboxProvider';
import { EditorPane } from '@/features/editor/EditorPane';
import { ResultsPanel } from '@/features/results/ResultsPanel';
import { StepCaption } from '@/features/timeline/StepCaption';
import { Timeline } from '@/features/timeline/Timeline';
import { useMessages } from '@/hooks/use-messages';
import { remToPx, useRootFont } from '@/hooks/use-root-font';
import type { Message } from '@/lib/messages';
import { modKey } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';
import { useSettingsStore } from '@/stores/settings';
import { useSchemaSync } from './useSchemaSync';

// Панели правой колонки, порядок совпадает с rightLayout; панель без содержимого показывает подсказку-заглушку.
// handle - имя ручки под панелью.
// Минимум редактора в rem: при крупном тексте (200%) поле и тулбар не схлопываются
const PANELS = [
  {
    id: 'board',
    title: 'Доска',
    hint: 'Здесь будет доска с таблицами',
    minSize: '25%',
    handle: 'Высота доски',
  },
  {
    id: 'timeline',
    title: 'Таймлайн',
    hint: 'Шаги выполнения запроса',
    minSize: '5%',
    handle: 'Высота таймлайна',
  },
  {
    id: 'editor',
    title: 'Редактор',
    hint: 'SQL-редактор',
    minSize: '9rem',
    handle: 'Граница редактора и результата',
  },
  { id: 'results', title: 'Результат', hint: 'Результат запроса и сообщения', minSize: '8%', handle: null },
] as const;

function BoardSlot({
  compact = false,
  showVersion = true,
  showControls = true,
}: {
  compact?: boolean;
  showVersion?: boolean;
  showControls?: boolean;
}) {
  useSchemaSync();
  const { status, version } = useSandbox();
  const boardRef = useRef<HTMLElement>(null);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const t = useMessages();
  useBoardHotkeys(boardRef);
  // Компакт скрывает контролы React Flow: + и - на самой доске
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        useBoardStore.getState().requestZoom(1);
      } else if (e.key === '-') {
        e.preventDefault();
        useBoardStore.getState().requestZoom(-1);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section
      ref={boardRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: доска принимает фокус ради клавиш плеера
      tabIndex={0}
      aria-label={t('Доска запроса')}
      data-testid="board-area"
      className="vs-board-area relative h-full w-full outline-none"
    >
      <BoardCanvas compact={compact} showControls={showControls} />
      <BoardStatus status={status} version={version} showVersion={showVersion} />
      {/* Режим фокуса (спека 3.1): видимый выход, не только ⌘\. В полосе хрома снизу: её кадры камеры держат пустой.
          Кнопка исчезает вместе с режимом, фокус уходит на доску */}
      {focusMode && (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 bg-background"
          onClick={() => {
            useSettingsStore.getState().toggleFocusMode();
            boardRef.current?.focus();
          }}
        >
          {t('Выйти из режима фокуса')} <Kbd>{modKey()} \</Kbd>
        </Button>
      )}
    </section>
  );
}

// Содержимое панелей правой колонки
const SLOTS: Partial<Record<string, ReactNode>> = {
  board: <BoardSlot />,
  timeline: <Timeline />,
  editor: <EditorPane />,
  results: <ResultsPanel />,
};

// Компактный режим крупного текста и низкого окна (P8.112): одна панель на экране вместо четырёх.
// Доска получает всю высоту, подпись шага живёт над ней, плеер остаётся внизу вкладки
function CompactWorkspace({
  onOpenLessons,
  onOpenTheory,
}: {
  onOpenLessons?: () => void;
  onOpenTheory?: () => void;
}) {
  const t = useMessages();
  const [tab, setTab] = useState('board');
  const listRef = useRef<HTMLDivElement>(null);
  // Крупный текст: полоса вкладок прокручивается, активную вкладку докручиваем в видимую часть
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab служит триггером, DOM читаем после рендера
  useEffect(() => {
    listRef.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      data-testid="workspace-tabs"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {/* Крупный текст: вкладки прокручиваются в своей полосе, кнопки не сжимаются и не
            накрывают друг друга (P8.112, audit 200% x 768) */}
        <TabsList
          ref={listRef}
          aria-label={t('Рабочая область')}
          className="h-auto min-w-0 flex-1 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:thin]"
        >
          <TabsTrigger value="board" className="text-sm">
            {t('Доска')}
          </TabsTrigger>
          <TabsTrigger value="editor" className="text-sm">
            {t('Редактор')}
          </TabsTrigger>
          <TabsTrigger value="results" className="text-sm">
            {t('Результат')}
          </TabsTrigger>
        </TabsList>
        <div className="flex shrink-0 gap-1">
          {onOpenLessons && (
            <Button id="lessons-button" variant="outline" size="sm" onClick={onOpenLessons}>
              {t('Уроки')}
            </Button>
          )}
          {onOpenTheory && (
            <Button id="theory-button" variant="outline" size="sm" onClick={onOpenTheory}>
              {t('Теория')}
            </Button>
          )}
          {/* Встроенные контролы React Flow прячутся под таблицей на крупном тексте: вписывание
              остаётся кнопкой в шапке, кнопки зума — жестами и клавиатурой */}
          <Button
            variant="outline"
            size="sm"
            aria-label={t('Вписать доску в экран')}
            title={t('Вписать доску в экран')}
            onClick={() => useBoardStore.getState().requestFit()}
          >
            <Maximize className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {/* Вкладки не размонтируют панели: трейс из редактора и сцена доски живут,
          пока пользователь ходит по вкладкам */}
      <TabsContent
        forceMount
        value="board"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <StepCaption />
        <div className="min-h-0 flex-1">
          {/* На крупном тексте плашка Postgres шире таблицы и ложится на строки (P8.112):
              версию показываем в обычной раскладке, здесь доска важнее */}
          <BoardSlot compact showVersion={false} showControls={false} />
        </div>
        {/* На коротком окне таймлайн не съедает доску: 7rem при корне 32px - это 224px */}
        <div className="h-[min(7rem,26dvh)] shrink-0 border-t">
          <Timeline showCaption={false} />
        </div>
      </TabsContent>
      <TabsContent forceMount value="editor" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <section aria-label={t('Редактор')} className="h-full min-h-0">
          <EditorPane />
        </section>
      </TabsContent>
      <TabsContent forceMount value="results" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <section aria-label={t('Результат')} className="h-full min-h-0">
          <ResultsPanel />
        </section>
      </TabsContent>
    </Tabs>
  );
}

export function BoardPane({
  compact = false,
  onOpenLessons,
  onOpenTheory,
}: {
  compact?: boolean;
  onOpenLessons?: () => void;
  onOpenTheory?: () => void;
}) {
  const rightLayout = useSettingsStore((s) => s.rightLayout);
  const setRightLayout = useSettingsStore((s) => s.setRightLayout);

  if (compact) return <CompactWorkspace onOpenLessons={onOpenLessons} onOpenTheory={onOpenTheory} />;

  return (
    <ResizablePanelGroup
      orientation="vertical"
      // Сохраняем только то, что потянул пользователь: пересчёт при маленьком окне не затирает раскладку
      onLayoutChanged={(layout, { isUserInteraction }) => {
        if (isUserInteraction) setRightLayout(PANELS.map((p) => layout[p.id] ?? 0));
      }}
    >
      {PANELS.map((panel, index) => (
        <PanelSlot key={panel.id} size={rightLayout[index] ?? 25} {...panel}>
          {SLOTS[panel.id]}
        </PanelSlot>
      ))}
    </ResizablePanelGroup>
  );
}

function PanelSlot(props: {
  id: string;
  title: Message;
  hint: Message;
  minSize: string;
  size: number;
  handle: Message | null;
  children?: ReactNode;
}) {
  const rootFont = useRootFont();
  const t = useMessages();
  return (
    <>
      <ResizablePanel id={props.id} defaultSize={`${props.size}%`} minSize={remToPx(props.minSize, rootFont)}>
        <section
          aria-label={t(props.title)}
          className={
            props.children
              ? 'h-full min-h-0'
              : 'flex h-full items-center justify-center text-sm text-muted-foreground'
          }
        >
          {props.children ?? t(props.hint)}
        </section>
      </ResizablePanel>
      {props.handle && <ResizableHandle aria-label={t(props.handle)} />}
    </>
  );
}
