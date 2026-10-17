import { useEffect, useRef, useState } from 'react';
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
  // До 80em (1280px при обычном шрифте) сайдбар уезжает в Sheet (спека 3.1). Порог в em: при крупном
  // шрифте браузера узкий режим включается раньше и теория не сжимается. Заглушка ниже 640px в px,
  // чтобы крупный шрифт на десктопе её не включал
  const narrow = useMediaQuery('(max-width: 80em)');
  const phone = useMediaQuery('(max-width: 639px)');
  const [forceOpen, setForceOpen] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  // Урок, при котором открыли Sheet: по нему решаем, куда вернуть фокус после закрытия
  const openedFor = useRef(lessonId);

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
          Открой на ноутбуке или планшете: на телефоне доска не поместится.
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
        // В режиме фокуса и на узком экране панелей меньше: такую раскладку не сохраняем, иначе потеряем ширины
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (isUserInteraction && !focusMode && !narrow)
            setMainLayout(MAIN_PANELS.map((id) => layout[id] ?? 0));
        }}
      >
        {/* Режим фокуса (спека 3.1): без сайдбара и теории, доска на всю ширину */}
        {!narrow && !focusMode && (
          <>
            {/* Минимум в rem растёт с размером текста: при 200% «Поиск» и названия уроков не обрезаются */}
            <ResizablePanel id="sidebar" defaultSize={`${mainLayout[0]}%`} minSize="12rem" maxSize="30%">
              <PanelErrorBoundary name="Темы">
                <LessonSidebar activeId={lessonId} onOpenSearch={() => setCommandOpen(true)} />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle aria-label="Ширина списка уроков" />
          </>
        )}
        {!focusMode && (
          <>
            {/* Минимум в rem: при крупном тексте строка урока не короче ~30 знаков. Уступает доска */}
            <ResizablePanel id="theory" defaultSize={`${mainLayout[1]}%`} minSize="20rem">
              <PanelErrorBoundary key={lessonId} name="Теория">
                <TheoryPane
                  meta={meta}
                  onOpenLessons={
                    narrow
                      ? () => {
                          openedFor.current = lessonId;
                          setLessonsOpen(true);
                        }
                      : undefined
                  }
                />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle aria-label="Граница теории и доски" />
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
          <SheetContent
            side="left"
            className="gap-0 p-0"
            // Sheet открыт не через SheetTrigger, сам Radix фокус не вернёт: после выбора урока
            // фокус на его заголовке, иначе на кнопке «Уроки». Ушли в поиск: фокус у поиска
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (commandOpen) return;
              document
                .getElementById(lessonId === openedFor.current ? 'lessons-button' : 'lesson-title')
                ?.focus();
            }}
          >
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
