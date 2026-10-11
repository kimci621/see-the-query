import { explainError } from '@/features/errors/explain';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';

// Сообщения: ошибка Postgres с человеческим объяснением (словарь Ф2) и оригиналом,
// NOTICE, пустое состояние. Оригинал всегда рядом (спека 5.14).
export function MessagesList({ trace }: { trace: Trace | null }) {
  const schema = useBoardStore((s) => s.schema);
  const error = trace?.error ?? null;
  const notices = trace?.notices ?? [];

  if (!error && notices.length === 0) {
    return (
      <div
        data-testid="messages-empty"
        className="grid h-full place-items-center text-sm text-muted-foreground"
      >
        Пока сообщений нет
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-2">
      {error && (
        <div
          role="alert"
          data-testid="pg-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm"
        >
          <p data-testid="pg-explain-title" className="font-semibold text-destructive">
            {explainError(error, { sql: trace?.sql ?? '', schema }).title}
          </p>
          <p data-testid="pg-explain-body" className="mt-1">
            {explainError(error, { sql: trace?.sql ?? '', schema }).body}
          </p>
          <pre
            data-testid="pg-original"
            className="mt-2 overflow-auto rounded bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
          >
            {error.message}
          </pre>
        </div>
      )}
      {notices.length > 0 && (
        <ul className={error ? 'mt-2' : ''}>
          {notices.map((n, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: notices are plain strings without id
              key={`notice-${i}`}
              data-testid={`notice-${i}`}
              className="rounded border bg-muted/30 p-2 font-mono text-xs"
            >
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
