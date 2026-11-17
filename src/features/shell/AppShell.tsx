import { Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useSandbox } from '@/features/db/SandboxProvider';
import { useLessonSandbox } from '@/features/db/useLessonSandbox';
import { getLesson } from '@/features/lessons/registry';
import { useMediaQuery, useViewportSize } from '@/hooks/use-media-query';
import { useMessages } from '@/hooks/use-messages';
import { remToPx, useRootFont } from '@/hooks/use-root-font';
import { useLessonStore } from '@/stores/lesson';
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
  const locale = useSettingsStore((s) => s.locale);
  const t = useMessages();
  const meta = lessonId ? getLesson(lessonId, locale) : undefined;
  const translationPending = locale === 'en' && !meta && !!lessonId && !!getLesson(lessonId);
  const workspaceMeta = meta ?? (translationPending && lessonId ? getLesson(lessonId) : undefined);
  const { sandbox } = useSandbox();
  useLessonSandbox(sandbox, workspaceMeta?.id, workspaceMeta?.dataset);
  const mainLayout = useSettingsStore((s) => s.mainLayout);
  const setMainLayout = useSettingsStore((s) => s.setMainLayout);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const toggleFocusMode = useSettingsStore((s) => s.toggleFocusMode);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // До 80em (1280px при обычном шрифте) сайдбар уезжает в Sheet (спека 3.1). Порог в em ловит
  // настройку шрифта браузера, но не html { font-size }: при крупном корне добавляем проверку в px.
  // Заглушка ниже 640px в px, чтобы крупный шрифт на десктопе её не включал
  const rootFont = useRootFont();
  const { width: viewportWidth, height: viewportHeight } = useViewportSize();
  const narrow = useMediaQuery('(max-width: 80em)') || (rootFont > 16 && viewportWidth < 80 * rootFont);
  // Крупный текст или низкое окно: четыре вертикальные панели не помещаются, правая колонка
  // переходит в компактный режим с вкладками (P8.112)
  const compact =
    viewportWidth < 1000 ||
    viewportHeight < 600 ||
    (rootFont >= 24 && (viewportWidth < 80 * rootFont || viewportHeight < 45 * rootFont));
  const phone = useMediaQuery('(max-width: 639px)');
  const [forceOpen, setForceOpen] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [theoryOpen, setTheoryOpen] = useState(false);
  // Урок, при котором открыли Sheet: по нему решаем, куда вернуть фокус после закрытия
  const openedFor = useRef(lessonId);

  // Выбрали урок (ссылка, поиск, «дальше») или экран стал шире: Sheet закрываем, иначе он остаётся
  // над теорией или сам откроется при возврате на узкий экран
  // biome-ignore lint/correctness/useExhaustiveDependencies: закрываем именно при смене урока и ширины
  useEffect(() => setLessonsOpen(false), [lessonId, narrow]);

  // Теория в Sheet компактного режима закрывается вместе со сменой урока
  // biome-ignore lint/correctness/useExhaustiveDependencies: закрываем именно при смене урока
  useEffect(() => setTheoryOpen(false), [lessonId]);

  // Вышли из компактного режима или ушли в фокус: лист теории больше не нужен
  useEffect(() => {
    if (!compact || focusMode) setTheoryOpen(false);
  }, [compact, focusMode]);

  // «На доску» из теории: закрываем Sheet и уводим фокус на доску, чтобы ученик увидел сцену
  useEffect(() => {
    const close = () => {
      setTheoryOpen(false);
      requestAnimationFrame(() => document.getElementById('board-area')?.focus());
    };
    window.addEventListener('vs:send-to-board', close);
    return () => window.removeEventListener('vs:send-to-board', close);
  }, []);

  // Посещение считает оболочка: в режиме фокуса теории (LessonView) нет, а урок открыт
  useEffect(() => {
    if (workspaceMeta) useLessonStore.getState().markVisited(workspaceMeta.id);
  }, [workspaceMeta]);

  // Вкладка называется по уроку: так её различают в истории и при переключении окон
  useEffect(() => {
    document.title = meta ? `${meta.title} · see-the-query` : 'see-the-query';
  }, [meta]);

  useGlobalHotkeys({
    commandMenu: () => setCommandOpen((o) => !o),
    focusMode: toggleFocusMode,
    help: () => setHelpOpen(true),
  });

  const openLessons = () => {
    openedFor.current = lessonId;
    setLessonsOpen(true);
  };

  if (phone && !forceOpen) {
    return (
      <main className="flex h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <h1 className="text-lg font-semibold">{t('see-the-query рассчитан на экран от 640 px')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Открой на ноутбуке или планшете: на телефоне доска не поместится.')}
        </p>
        <Button variant="outline" onClick={() => setForceOpen(true)}>
          {t('Всё равно открыть')}
        </Button>
      </main>
    );
  }

  return (
    <main className="h-svh w-full overflow-hidden bg-background text-foreground">
      {/* Компактный режим и фокус прячут теорию с её h1: странице нужен один заголовок.
          Когда лист теории открыт, заголовок даёт сам урок */}
      {(focusMode || (compact && !theoryOpen)) && (
        <h1 className="sr-only">{meta?.title ?? workspaceMeta?.title ?? t('Урок не найден')}</h1>
      )}
      <ResizablePanelGroup
        orientation="horizontal"
        // В режиме фокуса и на узком экране панелей меньше: такую раскладку не сохраняем, иначе потеряем ширины
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (isUserInteraction && !focusMode && !narrow && !compact)
            setMainLayout(MAIN_PANELS.map((id) => layout[id] ?? 0));
        }}
      >
        {/* Режим фокуса (спека 3.1): без сайдбара и теории, доска на всю ширину */}
        {!narrow && !focusMode && !compact && (
          <>
            {/* Минимум в rem растёт с размером текста: при 200% «Поиск» и названия уроков не обрезаются */}
            <ResizablePanel
              id="sidebar"
              defaultSize={`${mainLayout[0]}%`}
              minSize={remToPx('12rem', rootFont)}
              maxSize="30%"
            >
              <PanelErrorBoundary name={t('Темы')} locale={locale}>
                <LessonSidebar activeId={lessonId} onOpenSearch={() => setCommandOpen(true)} />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle aria-label={t('Ширина списка уроков')} />
          </>
        )}
        {!focusMode && !compact && (
          <>
            {/* Минимум в rem: при крупном тексте строка урока не короче ~30 знаков. Уступает доска */}
            <ResizablePanel
              id="theory"
              defaultSize={`${mainLayout[1]}%`}
              minSize={remToPx('20rem', rootFont)}
            >
              <PanelErrorBoundary key={lessonId} name={t('Теория')} locale={locale}>
                <TheoryPane
                  meta={meta}
                  translationPending={translationPending}
                  onOpenLessons={narrow ? openLessons : undefined}
                />
              </PanelErrorBoundary>
            </ResizablePanel>
            <ResizableHandle aria-label={t('Граница теории и доски')} />
          </>
        )}
        <ResizablePanel id="workspace" defaultSize={`${mainLayout[2]}%`} minSize="25%">
          <PanelErrorBoundary name={t('Доска')} locale={locale}>
            <BoardPane
              compact={compact}
              onOpenLessons={compact ? openLessons : undefined}
              onOpenTheory={compact && !focusMode ? () => setTheoryOpen(true) : undefined}
            />
          </PanelErrorBoundary>
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* Режим фокуса без компакта: теории и вкладок нет, кнопка «Уроки» остаётся над доской.
          В компакте она живёт в шапке вкладок и не накрывает первую вкладку */}
      {focusMode && !compact && (
        <Button
          id="lessons-button"
          variant="outline"
          size="sm"
          className="fixed top-2 left-2 z-20"
          onClick={openLessons}
        >
          <Menu className="size-4" aria-hidden /> {t('Уроки')}
        </Button>
      )}
      {(narrow || focusMode || compact) && (
        <Sheet open={lessonsOpen} onOpenChange={setLessonsOpen}>
          <SheetContent
            side="left"
            className="gap-0 p-0"
            // Sheet открыт не через SheetTrigger, сам Radix фокус не вернёт: после выбора урока
            // фокус на его заголовке, иначе на кнопке «Уроки». Ушли в поиск: фокус у поиска
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (commandOpen) return;
              // в режиме фокуса теории нет, заголовка урока тоже: тогда на кнопку «Уроки»
              const target = lessonId === openedFor.current ? null : document.getElementById('lesson-title');
              (target ?? document.getElementById('lessons-button'))?.focus();
            }}
          >
            <SheetTitle className="sr-only">{t('Уроки')}</SheetTitle>
            <SheetDescription className="sr-only">{t('Список уроков по главам')}</SheetDescription>
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
      {/* Компактный режим: теория не отнимает ширину у доски, открывается по кнопке */}
      {/* Лист теории рендерится только открытым: закрытие не ждёт exit-анимацию и не
          загораживает доску после «На доску» */}
      {compact && theoryOpen && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (open) return;
            setTheoryOpen(false);
            requestAnimationFrame(() => document.getElementById('theory-button')?.focus());
          }}
        >
          <SheetContent side="right" className="w-[min(32rem,92vw)] gap-0 p-0 sm:max-w-[min(32rem,92vw)]">
            <SheetTitle className="sr-only">{t('Теория')}</SheetTitle>
            <SheetDescription className="sr-only">{t('Текст урока')}</SheetDescription>
            <TheoryPane meta={meta} translationPending={translationPending} />
          </SheetContent>
        </Sheet>
      )}
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      <HotkeysHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </main>
  );
}
