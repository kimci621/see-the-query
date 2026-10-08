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

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Поиск по урокам"
      description="Название, номер или тег"
    >
      <CommandInput placeholder="Урок, тема, ключевое слово SQL..." />
      <CommandList>
        <CommandEmpty>Ничего не нашлось</CommandEmpty>
        {lessonsByChapter().map(({ chapter, lessons }) => (
          <CommandGroup key={chapter.id} heading={`${chapter.number}. ${chapter.title}`}>
            {lessons.map((l) => (
              <CommandItem
                key={l.id}
                value={`${l.number} ${l.title}`}
                keywords={[...l.tags, chapter.title]}
                onSelect={() => {
                  navigate(`/l/${l.id}`);
                  onOpenChange(false);
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">{l.number}</span>
                {l.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
