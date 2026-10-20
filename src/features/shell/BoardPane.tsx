import { type ReactNode, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { BoardCanvas } from '@/features/board/BoardCanvas';
import { BoardStatus } from '@/features/board/BoardStatus';
import { useBoardHotkeys } from '@/features/board/useBoardHotkeys';
import { useSandbox } from '@/features/db/SandboxProvider';
import { EditorPane } from '@/features/editor/EditorPane';
import { ResultsPanel } from '@/features/results/ResultsPanel';
import { Timeline } from '@/features/timeline/Timeline';
import { remToPx, useRootFont } from '@/hooks/use-root-font';
import { modKey } from '@/lib/utils';
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

function BoardSlot() {
  useSchemaSync();
  const { status, version } = useSandbox();
  const boardRef = useRef<HTMLDivElement>(null);
  const focusMode = useSettingsStore((s) => s.focusMode);
  useBoardHotkeys(boardRef);
  return (
    <div
      ref={boardRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: доска принимает фокус ради клавиш плеера
      tabIndex={0}
      data-testid="board-area"
      className="relative h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BoardCanvas />
      <BoardStatus status={status} version={version} />
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
          Выйти из режима фокуса <Kbd>{modKey()} \</Kbd>
        </Button>
      )}
    </div>
  );
}

// Содержимое панелей правой колонки
const SLOTS: Partial<Record<string, ReactNode>> = {
  board: <BoardSlot />,
  timeline: <Timeline />,
  editor: <EditorPane />,
  results: <ResultsPanel />,
};

export function BoardPane() {
  const rightLayout = useSettingsStore((s) => s.rightLayout);
  const setRightLayout = useSettingsStore((s) => s.setRightLayout);

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
  title: string;
  hint: string;
  minSize: string;
  size: number;
  handle: string | null;
  children?: ReactNode;
}) {
  const rootFont = useRootFont();
  return (
    <>
      <ResizablePanel id={props.id} defaultSize={`${props.size}%`} minSize={remToPx(props.minSize, rootFont)}>
        <section
          aria-label={props.title}
          className={
            props.children
              ? 'h-full min-h-0'
              : 'flex h-full items-center justify-center text-sm text-muted-foreground'
          }
        >
          {props.children ?? props.hint}
        </section>
      </ResizablePanel>
      {props.handle && <ResizableHandle aria-label={props.handle} />}
    </>
  );
}
