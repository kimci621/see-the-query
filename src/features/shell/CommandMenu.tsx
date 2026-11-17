import { useCommandState } from 'cmdk';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { lessonsByChapter, lessonsForLocale } from '@/features/lessons/registry';
import { useMessages } from '@/hooks/use-messages';
import { lessonHref } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings';

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const locale = useSettingsStore((s) => s.locale);
  const t = useMessages();
  // У диалога нет триггера, Radix сам фокус не вернёт: запоминаем элемент до открытия
  const returnTo = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement;
  }, [open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Поиск по урокам')}
      description={t('Название, номер или тег')}
      onCloseAutoFocus={(e) => {
        if (!(returnTo.current instanceof HTMLElement) || !returnTo.current.isConnected) return;
        e.preventDefault();
        returnTo.current.focus();
      }}
    >
      <CommandInput placeholder={t('Урок, тема, ключевое слово SQL...')} />
      <CommandList label={t('Уроки')}>
        <SelectedIntoView />
        <CommandEmpty>{t('Ничего не нашлось')}</CommandEmpty>
        <LessonItems
          onPick={(id) => {
            navigate(lessonHref(id, locale));
            onOpenChange(false);
          }}
        />
      </CommandList>
    </CommandDialog>
  );
}

// После фильтрации cmdk оставляет scrollTop от полного списка, и выбранный пункт может оказаться
// выше видимой области: Enter ведёт в урок, которого не видно. Докручиваем выбранный пункт к краю
function SelectedIntoView() {
  const selected = useCommandState((s) => s.selectedItemId);
  useEffect(() => {
    if (!selected) return;
    const item =
      document.getElementById(selected) ?? document.querySelector('[cmdk-item][aria-selected="true"]');
    item?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return null;
}

// cmdk 1.1.1 сортирует пункты внутри группы, но не сами группы (ищет группу по useId, а в data-value
// у неё заголовок). С группами первым стоял бы пункт первой главы с любым слабым совпадением.
// Поэтому при поиске список плоский: cmdk ставит выше пункт с лучшим score
function LessonItems({ onPick }: { onPick: (id: string) => void }) {
  const searching = useCommandState((s) => s.search !== '');
  const locale = useSettingsStore((s) => s.locale);
  return lessonsByChapter(lessonsForLocale(locale), locale).map(({ chapter, lessons }) => {
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
