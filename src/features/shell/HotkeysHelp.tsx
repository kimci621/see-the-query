import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { modKey } from '@/lib/utils';

// Полный список из спеки 3.10; часть клавиш заработает в следующих фазах. mod: ⌘ или Ctrl по платформе
const HOTKEYS: Array<{ keys: string[]; action: string; soon?: true }> = [
  { keys: ['mod', 'K'], action: 'Поиск по урокам' },
  { keys: ['mod', '\\'], action: 'Режим фокуса: доска на всю ширину' },
  { keys: ['mod', '⏎'], action: 'Применить запрос' },
  { keys: ['mod', 'Z'], action: 'Отменить применённый запрос' },
  { keys: ['mod', '0'], action: 'Вписать доску в экран' },
  { keys: ['Space'], action: 'Пауза и продолжение сцены', soon: true },
  { keys: ['←', '→'], action: 'Шаг сцены назад и вперёд', soon: true },
  { keys: ['Esc'], action: 'Закрыть сцену', soon: true },
  { keys: ['?'], action: 'Эта шпаргалка' },
];

export function HotkeysHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Горячие клавиши</DialogTitle>
          <DialogDescription>Что можно сделать с клавиатуры.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {HOTKEYS.map((h) => (
            <div key={h.action} className="contents">
              <dt className="flex gap-1">
                {h.keys.map((k) => (
                  <Kbd key={k}>{k === 'mod' ? modKey() : k}</Kbd>
                ))}
              </dt>
              <dd>
                {h.action}
                {h.soon && <span className="text-muted-foreground"> · скоро</span>}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
