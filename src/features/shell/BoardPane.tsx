import { type ReactNode, useRef } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { BoardCanvas } from '@/features/board/BoardCanvas';
import { BoardStatus } from '@/features/board/BoardStatus';
import { useBoardHotkeys } from '@/features/board/useBoardHotkeys';
import { useSandbox } from '@/features/db/SandboxProvider';
import { EditorPane } from '@/features/editor/EditorPane';
import { ResultsPanel } from '@/features/results/ResultsPanel';
import { Timeline } from '@/features/timeline/Timeline';
import { useSettingsStore } from '@/stores/settings';
import { useSchemaSync } from './useSchemaSync';

// Панели правой колонки; панель без содержимого показывает подсказку-заглушку
const PANELS = [
  { id: 'board', title: 'Доска', hint: 'Здесь будет доска с таблицами', minSize: 25 },
  { id: 'timeline', title: 'Таймлайн', hint: 'Шаги выполнения запроса', minSize: 5 },
  { id: 'editor', title: 'Редактор', hint: 'SQL-редактор', minSize: 10 },
  { id: 'results', title: 'Результат', hint: 'Результат запроса и сообщения', minSize: 8 },
] as const;

function BoardSlot() {
  useSchemaSync();
  const { status, version } = useSandbox();
  const boardRef = useRef<HTMLDivElement>(null);
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
        <PanelSlot
          key={panel.id}
          last={index === PANELS.length - 1}
          size={rightLayout[index] ?? 25}
          {...panel}
        >
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
  minSize: number;
  size: number;
  last: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <ResizablePanel id={props.id} defaultSize={`${props.size}%`} minSize={`${props.minSize}%`}>
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
      {!props.last && <ResizableHandle />}
    </>
  );
}
