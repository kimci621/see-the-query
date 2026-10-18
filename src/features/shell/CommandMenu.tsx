import { useCommandState } from 'cmdk';
import { Fragment, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { lessonsByChapter } from '@/features/lessons/registry';

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // У диалога нет триггера, Radix сам фокус не вернёт: запоминаем элемент до открытия
  const returnTo = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement;
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Поиск по урокам"
      description="Название, номер или тег"
      onCloseAutoFocus={(e) => {
        if (!(returnTo.current instanceof HTMLElement) || !returnTo.current.isConnected) return;
        e.preventDefault();
        returnTo.current.focus();
      }}
    >
      <CommandInput placeholder="Урок, тема, ключевое слово SQL..." />
      <CommandList>
        <CommandEmpty>Ничего не нашлось</CommandEmpty>
        <LessonItems
          onPick={(id) => {
            navigate(`/l/${id}`);
            onOpenChange(false);
          }}
        />
      </CommandList>
    </CommandDialog>
  );
}

// cmdk 1.1.1 сортирует пункты внутри группы, но не сами группы (ищет группу по useId, а в data-value
// у неё заголовок). С группами первым стоял бы пункт первой главы с любым слабым совпадением.
// Поэтому при поиске список плоский: cmdk ставит выше пункт с лучшим score
function LessonItems({ onPick }: { onPick: (id: string) => void }) {
  const searching = useCommandState((s) => s.search !== '');
  return lessonsByChapter().map(({ chapter, lessons }) => {
    const items = lessons.map((l) => (
      <CommandItem
        key={l.id}
        value={`${l.number} ${l.title}`}
        keywords={[...l.tags, chapter.title]}
        onSelect={() => onPick(l.id)}
      >
        <span className="font-mono text-xs text-muted-foreground">{l.number}</span>
        {l.title}
      </CommandItem>
    ));
    return searching ? (
      <Fragment key={chapter.id}>{items}</Fragment>
    ) : (
      <CommandGroup key={chapter.id} heading={`${chapter.number}. ${chapter.title}`}>
        {items}
      </CommandGroup>
    );
  });
}
