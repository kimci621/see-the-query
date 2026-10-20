import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import type { Sandbox } from '@/features/db/sandbox';
import type { QueryResult } from '@/features/db/types';
import { statementAt } from '@/features/sql/statements';
import type { ParsedStatement } from '@/features/sql/types';
import type { Trace } from '@/features/tracer/types';
import { rowsWord } from '@/lib/plural';
import { cn, modKey } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { notifyApplied, notifyDbError, undoLast } from './notifyDbError';
import { appliedTrace } from './useLiveTrace';
import { useParsedText } from './useParsedText';

const STATUS_LABEL: Record<'idle' | 'tracing' | 'ready' | 'error' | 'stale', string> = {
  idle: 'Превью: база не меняется',
  tracing: 'Считаем',
  ready: 'Превью: база не меняется',
  error: 'Ошибка',
  stale: 'Недописан',
};

// UPDATE/DELETE без WHERE: превью затронуло все строки таблицы, число берём из его итога.
// Трасса чужого текста или с ошибкой, пустая таблица - предупреждать не о чем
function noWhereCaution(stmt: ParsedStatement | null, trace: Trace | null): string | null {
  if (!stmt || !trace || trace.sql !== stmt.text || trace.error) return null;
  const body = stmt.ast as unknown as Record<string, { whereClause?: unknown } | undefined>;
  const dml = stmt.kind === 'update' ? body.UpdateStmt : stmt.kind === 'delete' ? body.DeleteStmt : undefined;
  const n = trace.result?.rowCount ?? 0;
  if (!dml || dml.whereClause || n === 0) return null;
  const [one, many] = stmt.kind === 'update' ? ['изменится', 'изменятся'] : ['удалится', 'удалятся'];
  return n === 1 ? `${one} единственная строка` : `${many} все ${rowsWord(n)}`;
}

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
  const trace = useSceneStore((s) => s.trace);
  const hasError = trace?.error != null;
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [journal, setJournal] = useState<readonly string[]>([]);

  // журнал: пустой блокирует «Отменить»
  useEffect(() => {
    if (!sandbox) return;
    const sync = () => setJournal(sandbox.journal());
    sync();
    return sandbox.subscribe((e) => {
      if (e.type === 'changed') sync();
    });
  }, [sandbox]);

  const parsed = useParsedText(text);
  const statements = parsed?.ok ? parsed.statements : [];
  const statementCount = statements.length;
  const current = statementAt(statements, cursor);
  // Текущий оператор применён и текст не правили: кнопка гаснет до «Применено» и ничего не делает
  // (спека 3.9). SELECT ничего не пишет в базу, для него кнопка тоже вторичная
  const applied = useEditorStore((s) => current != null && s.applied[current.index] != null);

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
  const caution = !stale && !applied && status === 'ready' ? noWhereCaution(current, trace) : null;

  const applyAll = () =>
    void run(async () => {
      const results: QueryResult[] = [];
      for (const s of statements) {
        const started = performance.now();
        const own = (await sandbox?.apply(s.text)) ?? [];
        results.push(...own);
        // как у «Применить»: применённый оператор превью не повторяет
        if (s.kind !== 'select' && useEditorStore.getState().text === text)
          useEditorStore
            .getState()
            .markApplied(s.index, appliedTrace(s, own, Math.round(performance.now() - started)));
      }
      notifyApplied(results);
    });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t px-2 py-1">
      <Badge
        variant="outline"
        data-testid="preview-status"
        className={cn(
          'gap-1.5 text-xs',
          shown === 'error' && 'border-destructive/40 text-destructive',
          caution && 'border-changed/60 text-changed',
        )}
      >
        {shown === 'tracing' ? (
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
        ) : (
          <span aria-hidden>●</span>
        )}
        {STATUS_LABEL[shown]}
        {caution && ` · ${caution}`}
      </Badge>
      <div className="ml-auto flex flex-wrap items-center gap-x-1.5 gap-y-1">
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
          disabled={busy || !sandbox || journal.length === 0}
          onClick={() => void run(() => (sandbox ? undoLast(sandbox) : Promise.resolve()))}
        >
          Отменить
        </Button>
        {/* DialogTrigger: после Esc или «Отмена» Radix возвращает фокус на «Сброс» */}
        <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="reset-button" disabled={busy || !sandbox}>
              Сброс
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Сбросить урок?</DialogTitle>
              <DialogDescription>
                Все применённые запросы будут отменены, данные вернутся к началу урока.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmReset(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmReset(false);
                  void run(() => sandbox?.reset() ?? Promise.resolve());
                }}
              >
                Сбросить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          size="sm"
          // превью с ошибкой: применять, скорее всего, нечего, кнопка не зовёт (спека 3.9)
          variant={applied || hasError || current?.kind === 'select' ? 'outline' : 'default'}
          data-testid="apply-button"
          disabled={busy || !sandbox || statementCount === 0}
          // не disabled: фокус клавиатуры остаётся на кнопке после применения
          aria-disabled={applied || undefined}
          onClick={onApplyCurrent}
        >
          {applied ? 'Применено' : 'Применить'} <Kbd>{modKey()} ⏎</Kbd>
        </Button>
      </div>
    </div>
  );
}
