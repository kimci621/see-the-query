import type { DbError } from '@/features/db/types';
import type { Trace } from '@/features/tracer/types';
import { ErrorCard } from './ErrorCard';

// Сообщения: карточка ошибки (объяснение словаря и оригинал Postgres), NOTICE, пустое состояние.
export function MessagesList({
  trace,
  parseError = null,
}: {
  trace: Trace | null;
  parseError?: { error: DbError; sql: string } | null; // ошибка разбора недописанного запроса вместо ошибки трейса
}) {
  const shown = parseError ?? (trace?.error ? { error: trace.error, sql: trace.sql } : null);
  const parse = parseError != null;
  const notices = trace?.notices ?? [];

  if (!shown && notices.length === 0) {
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
      {shown && <ErrorCard error={shown.error} sql={shown.sql} parse={parse} />}
      {notices.length > 0 && (
        <ul className={shown ? 'mt-2' : ''}>
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
