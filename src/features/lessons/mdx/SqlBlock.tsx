import { Check, Copy, LoaderCircle, Play, Zap } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSandbox } from '@/features/db/SandboxProvider';
import { applyCurrent } from '@/features/editor/applyCurrent';
import { useEditorStore } from '@/stores/editor';
import { useLessonStore } from '@/stores/lesson';
import { parseSqlMeta } from './sql-meta';

type PreProps = ComponentProps<'pre'> & { 'data-lang'?: string; 'data-meta'?: string; 'data-code'?: string };

// «▶ На доску»: запрос уходит в редактор, дальше живой превью сам строит трассу и проигрывает сцену
export function sendToBoard(sql: string, lessonId: string | undefined): void {
  useEditorStore.getState().insertQuery(sql);
  if (lessonId) useLessonStore.getState().markRanExample(lessonId);
}

// Подменяет <pre> в MDX: SQL-блоки получают кнопки, остальные рендерятся как есть
export function SqlBlock(props: PreProps) {
  const { lessonId } = useParams();
  const { sandbox } = useSandbox();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  if (props['data-lang'] !== 'sql') return <pre {...props} />;
  const sql = props['data-code'] ?? '';
  const meta = parseSqlMeta(props['data-meta'] ?? '');

  const copy = () => {
    navigator.clipboard.writeText(sql).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error('Не удалось скопировать: браузер не дал доступ к буферу обмена'),
    );
  };

  // Пример меняет данные: показываем запрос в редакторе и применяем тем же путём, что кнопка редактора
  // (тосты, камера, «Применено» в тулбаре). Пока база отвечает, повторный клик ничего не делает
  const apply = async () => {
    if (!sandbox || busy) return;
    sendToBoard(sql, lessonId);
    setBusy(true);
    try {
      await applyCurrent(sandbox);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-4" data-testid="sql-block">
      <pre {...props} />
      <div className="not-prose mt-1 flex flex-wrap items-center gap-2">
        {meta.apply ? (
          <Button
            size="sm"
            variant="secondary"
            // без песочницы применять некуда; занятая кнопка не disabled, чтобы фокус клавиатуры остался на ней
            disabled={!sandbox}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={() => void apply()}
          >
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Zap aria-hidden />}
            Применить
          </Button>
        ) : meta.run ? (
          <Button size="sm" variant="secondary" onClick={() => sendToBoard(sql, lessonId)}>
            <Play aria-hidden />
            На доску
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
      </div>
    </div>
  );
}
