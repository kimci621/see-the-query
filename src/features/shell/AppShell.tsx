import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useSandbox } from '@/features/db/SandboxProvider';
import { useLessonSandbox } from '@/features/db/useLessonSandbox';
import { getLesson } from '@/features/lessons/registry';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useSettingsStore } from '@/stores/settings';
import { BoardPane } from './BoardPane';
import { CommandMenu } from './CommandMenu';
import { HotkeysHelp } from './HotkeysHelp';
import { LessonSidebar } from './LessonSidebar';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { TheoryPane } from './TheoryPane';
import { useGlobalHotkeys } from './useGlobalHotkeys';

// Порядок совпадает с mainLayout: [сайдбар, теория, правая колонка]
const MAIN_PANELS = ['sidebar', 'theory', 'workspace'] as const;

export function AppShell() {
  const { lessonId } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const { sandbox } = useSandbox();
  useLessonSandbox(sandbox, meta?.id, meta?.dataset);
  const mainLayout = useSettingsStore((s) => s.mainLayout);
  const setMainLayout = useSettingsStore((s) => s.setMainLayout);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const toggleFocusMode = useSettingsStore((s) => s.toggleFocusMode);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Ниже 1024px сайдбар уезжает в Sheet, ниже 640px вместо оболочки заглушка
  const narrow = useMediaQuery('(max-width: 1023px)');
  const phone = useMediaQuery('(max-width: 639px)');
  const [forceOpen, setForceOpen] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);

  // Выбрали урок (ссылка, поиск, «дальше») или экран стал шире: Sheet закрываем, иначе он остаётся
  // над теорией или сам откроется при возврате на узкий экран
  // biome-ignore lint/correctness/useExhaustiveDependencies: закрываем именно при смене урока и ширины
  useEffect(() => setLessonsOpen(false), [lessonId, narrow]);

  // Вкладка называется по уроку: так её различают в истории и при переключении окон
  useEffect(() => {
    document.title = meta ? `${meta.title} · see-the-query` : 'see-the-query';
  }, [meta]);

  useGlobalHotkeys({
    commandMenu: () => setCommandOpen((o) => !o),
    focusMode: toggleFocusMode,
    help: () => setHelpOpen(true),
  });

  if (phone && !forceOpen) {
    return (
      <main className="flex h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <h1 className="text-lg font-semibold">see-the-query рассчитан на экран от 1024 px</h1>
        <p className="text-sm text-muted-foreground">
          Откройте на ноутбуке или планшете: на телефоне доска не поместится.
        </p>
        <Button variant="outline" onClick={() => setForceOpen(true)}>
          Всё равно открыть
        </Button>
      </main>
    );
  }

  return (
    <main className="h-svh w-full overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup
        orientation="horizontal"
        // В режиме фокуса и на узком экране панелей две: такую раскладку не сохраняем, иначе потеряем ширину теории
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (isUserInteraction && !focusMode && !narrow)
            setMainLayout(MAIN_PANELS.map((id) => layout[id] ?? 0));
        }}
      >
        {!narrow && (
          <>
            <ResizablePanel id="sidebar" defaultSize={`${mainLayout[0]}%`} minSize="10%" maxSize="30%">
              <PanelErrorBoundary name="Темы">
                <LessonSidebar activeId={lessonId} onOpenSearch={() => setCommandOpen(true)} />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        {!focusMode && (
          <>
            <ResizablePanel id="theory" defaultSize={`${mainLayout[1]}%`} minSize="20%">
              <PanelErrorBoundary key={lessonId} name="Теория">
                <TheoryPane meta={meta} onOpenLessons={narrow ? () => setLessonsOpen(true) : undefined} />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel id="workspace" defaultSize={`${mainLayout[2]}%`} minSize="25%">
          <PanelErrorBoundary name="Доска">
            <BoardPane />
          </PanelErrorBoundary>
        </ResizablePanel>
      </ResizablePanelGroup>
      {narrow && (
        <Sheet open={lessonsOpen} onOpenChange={setLessonsOpen}>
          <SheetContent side="left" className="gap-0 p-0">
            <SheetTitle className="sr-only">Уроки</SheetTitle>
            <SheetDescription className="sr-only">Список уроков по главам</SheetDescription>
            <LessonSidebar
              activeId={lessonId}
              onOpenSearch={() => {
                setLessonsOpen(false);
                setCommandOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      )}
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      <HotkeysHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
