import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

// Полный список из спеки 3.10; часть клавиш заработает в следующих фазах
const HOTKEYS: Array<{ keys: string[]; action: string }> = [
  { keys: ['⌘', 'K'], action: 'Поиск по урокам' },
  { keys: ['⌘', '\\'], action: 'Режим фокуса: доска на всю ширину' },
  { keys: ['⌘', '⏎'], action: 'Применить запрос' },
  { keys: ['⌘', 'Z'], action: 'Отменить применённый запрос' },
  { keys: ['⌘', '0'], action: 'Вписать доску в экран' },
  { keys: ['Space'], action: 'Пауза и продолжение сцены' },
  { keys: ['←', '→'], action: 'Шаг сцены назад и вперёд' },
  { keys: ['Esc'], action: 'Закрыть сцену' },
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
          <DialogDescription>На Windows и Linux вместо ⌘ жми Ctrl.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {HOTKEYS.map((h) => (
            <div key={h.action} className="contents">
              <dt className="flex gap-1">
                {h.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd>{h.action}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
