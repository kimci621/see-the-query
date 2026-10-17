import { ChevronRight, Circle, CircleCheck, CircleDot, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Kbd } from '@/components/ui/kbd';
import { Progress } from '@/components/ui/progress';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { LESSONS, lessonsByChapter } from '@/features/lessons/registry';
import { modKey } from '@/lib/utils';
import { lessonStatus, useLessonStore } from '@/stores/lesson';
import { ThemeToggle } from './ThemeToggle';

const STATUS = {
  new: { Icon: Circle, label: 'не открыт' },
  visited: { Icon: CircleDot, label: 'открыт' },
  completed: { Icon: CircleCheck, label: 'пройден' },
} as const;

export function LessonSidebar({
  activeId,
  onOpenSearch,
}: {
  activeId: string | undefined;
  onOpenSearch: () => void;
}) {
  const byId = useLessonStore((s) => s.byId);
  const groups = lessonsByChapter();
  const done = LESSONS.filter((l) => byId[l.id]?.completed).length;
  const percent = LESSONS.length ? Math.round((done / LESSONS.length) * 100) : 0;
  const activeChapter = groups.find((g) => g.lessons.some((l) => l.id === activeId))?.chapter.id;
  // Раскрытые главы: при смене урока (поиск, «дальше») глава активного урока раскрывается,
  // остальные остаются как есть
  const [openChapters, setOpenChapters] = useState(() => new Set(activeChapter ? [activeChapter] : []));
  useEffect(() => {
    if (activeChapter)
      setOpenChapters((prev) => (prev.has(activeChapter) ? prev : new Set(prev).add(activeChapter)));
  }, [activeChapter]);

  return (
    <SidebarProvider className="h-full min-h-0">
      <Sidebar collapsible="none" className="h-full w-full border-r">
        <SidebarHeader className="gap-2">
          <p className="px-2 font-semibold">see-the-query</p>
          <Button variant="outline" size="sm" className="justify-between" onClick={onOpenSearch}>
            <span className="flex items-center gap-2">
              <Search className="size-4" /> Поиск
            </span>
            <Kbd>{modKey()} K</Kbd>
          </Button>
        </SidebarHeader>
        <nav aria-label="Уроки" className="flex min-h-0 flex-1 flex-col">
          <SidebarContent>
            {groups.map(({ chapter, lessons }) => (
              <Collapsible
                key={chapter.id}
                open={openChapters.has(chapter.id)}
                onOpenChange={(open) =>
                  setOpenChapters((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(chapter.id);
                    else next.delete(chapter.id);
                    return next;
                  })
                }
                className="group/collapsible"
              >
                <SidebarGroup>
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="w-full text-left">
                      {chapter.number}. {chapter.title}
                      <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarMenu>
                      {lessons.map((l) => {
                        const { Icon, label } = STATUS[lessonStatus(byId[l.id])];
                        return (
                          <SidebarMenuItem key={l.id}>
                            <SidebarMenuButton asChild isActive={l.id === activeId}>
                              <Link to={`/l/${l.id}`} title={l.title}>
                                <Icon className="size-3.5 shrink-0" aria-label={label} role="img" />
                                <span className="font-mono text-xs text-muted-foreground">{l.number}</span>
                                <span className="truncate">{l.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            ))}
          </SidebarContent>
        </nav>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2">
            <div className="flex-1 space-y-1">
              <Progress value={percent} aria-label="Прогресс по программе" />
              <p className="text-xs text-muted-foreground">
                Пройдено {done} из {LESSONS.length}
              </p>
            </div>
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
