import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import type { Sandbox } from '@/features/db/sandbox';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { notifyDbError } from './notifyDbError';
import { useParsedText } from './useParsedText';

const STATUS_LABEL: Record<'idle' | 'tracing' | 'ready' | 'error' | 'stale', string> = {
  idle: 'Превью: база не меняется',
  tracing: 'Считаем',
  ready: 'Превью: база не меняется',
  error: 'Ошибка',
  stale: 'Недописан',
};

// Строка управления под редактором. Применение текущего оператора идёт через
// onApplyCurrent: один путь для кнопки, ⌘⏎ из keymap CodeMirror и ⌘⏎ вне редактора.
export function EditorToolbar({
  sandbox,
  onApplyCurrent,
}: {
  sandbox: Sandbox | null;
  onApplyCurrent: () => void;
}) {
  const status = useSceneStore((s) => s.status);
  const stale = useSceneStore((s) => s.stale);
  const hasError = useSceneStore((s) => s.trace?.error != null);
  const text = useEditorStore((s) => s.text);
  const [busy, setBusy] = useState(false);
  const [journalLength, setJournalLength] = useState(0);

  // длина журнала: для блокировки «Отменить»
  useEffect(() => {
    if (!sandbox) return;
    const sync = () => setJournalLength(sandbox.journal().length);
    sync();
    return sandbox.subscribe((e) => {
      if (e.type === 'changed') sync();
    });
  }, [sandbox]);

  const parsed = useParsedText(text);
  const statements = parsed?.ok ? parsed.statements : [];
  const statementCount = statements.length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      // ошибки применения показываем тостом; превью оператора продублирует её карточкой
      notifyDbError(e, text);
    } finally {
      setBusy(false);
    }
  };

  const shown = stale ? 'stale' : hasError ? 'error' : status;

  const applyAll = () =>
    void run(async () => {
      for (const s of statements) await sandbox?.apply(s.text);
    });

  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-2 py-1">
      <Badge
        variant="outline"
        data-testid="preview-status"
        className={cn('gap-1.5 text-xs', shown === 'error' && 'border-destructive/40 text-destructive')}
      >
        {shown === 'tracing' ? (
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
        ) : (
          <span aria-hidden>●</span>
        )}
        {STATUS_LABEL[shown]}
      </Badge>
      <div className="ml-auto flex items-center gap-1.5">
        {statementCount > 1 && (
          <Button
            variant="outline"
            size="sm"
            data-testid="apply-all-button"
            disabled={busy || !sandbox}
            onClick={applyAll}
          >
            Применить всё
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          data-testid="undo-button"
          disabled={busy || !sandbox || journalLength === 0}
          onClick={() => void run(() => sandbox?.undo() ?? Promise.resolve())}
        >
          Отменить
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="reset-button"
          disabled={busy || !sandbox}
          onClick={() => void run(() => sandbox?.reset() ?? Promise.resolve())}
        >
          Сброс
        </Button>
        <Button
          size="sm"
          data-testid="apply-button"
          disabled={busy || !sandbox || statementCount === 0}
          onClick={onApplyCurrent}
        >
          Применить <Kbd>⌘⏎</Kbd>
        </Button>
      </div>
    </div>
  );
}
