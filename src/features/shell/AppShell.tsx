import { useState } from 'react';
import { useParams } from 'react-router';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { getLesson } from '@/features/lessons/registry';
import { useSettingsStore } from '@/stores/settings';
import { BoardPane } from './BoardPane';
import { CommandMenu } from './CommandMenu';
import { HotkeysHelp } from './HotkeysHelp';
import { LessonSidebar } from './LessonSidebar';
import { TheoryPane } from './TheoryPane';
import { useGlobalHotkeys } from './useGlobalHotkeys';

// Порядок совпадает с mainLayout: [сайдбар, теория, правая колонка]
const MAIN_PANELS = ['sidebar', 'theory', 'workspace'] as const;

export function AppShell() {
  const { lessonId } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const mainLayout = useSettingsStore((s) => s.mainLayout);
  const setMainLayout = useSettingsStore((s) => s.setMainLayout);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const toggleFocusMode = useSettingsStore((s) => s.toggleFocusMode);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useGlobalHotkeys({
    commandMenu: () => setCommandOpen((o) => !o),
    focusMode: toggleFocusMode,
    help: () => setHelpOpen(true),
  });

  return (
    <div className="h-svh w-full overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup
        orientation="horizontal"
        // В режиме фокуса панелей две: такую раскладку не сохраняем, иначе потеряем ширину теории
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (isUserInteraction && !focusMode) setMainLayout(MAIN_PANELS.map((id) => layout[id] ?? 0));
        }}
      >
        <ResizablePanel id="sidebar" defaultSize={`${mainLayout[0]}%`} minSize="10%" maxSize="30%">
          <LessonSidebar activeId={lessonId} onOpenSearch={() => setCommandOpen(true)} />
        </ResizablePanel>
        <ResizableHandle />
        {!focusMode && (
          <>
            <ResizablePanel id="theory" defaultSize={`${mainLayout[1]}%`} minSize="20%">
              <TheoryPane meta={meta} />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel id="workspace" defaultSize={`${mainLayout[2]}%`} minSize="25%">
          <BoardPane />
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      <HotkeysHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
