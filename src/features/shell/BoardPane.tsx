import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useSettingsStore } from '@/stores/settings';

// Заглушки панелей правой колонки; содержимое появится в Ф3, Ф4, Ф6
const PANELS = [
  { id: 'board', title: 'Доска', hint: 'Здесь будет доска с таблицами', minSize: 25 },
  { id: 'timeline', title: 'Таймлайн', hint: 'Шаги выполнения запроса', minSize: 5 },
  { id: 'editor', title: 'Редактор', hint: 'SQL-редактор', minSize: 10 },
  { id: 'results', title: 'Результат', hint: 'Результат запроса и сообщения', minSize: 8 },
] as const;

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
        />
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
}) {
  return (
    <>
      <ResizablePanel id={props.id} defaultSize={`${props.size}%`} minSize={`${props.minSize}%`}>
        <section
          aria-label={props.title}
          className="flex h-full items-center justify-center text-sm text-muted-foreground"
        >
          {props.hint}
        </section>
      </ResizablePanel>
      {!props.last && <ResizableHandle />}
    </>
  );
}
