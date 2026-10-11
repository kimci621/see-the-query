import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Sandbox } from '@/features/db/sandbox';
import { useBoardStore } from '@/stores/board';
import { isTableVisible } from './layout';

export function pgVersionLabel(version: string | null): string | null {
  const m = version?.match(/PostgreSQL (\d+(?:\.\d+)?)/);
  return m ? `PostgreSQL ${m[1]} в браузере` : null;
}

// Слои поверх доски: загрузка, пустая схема, сбой, версия Postgres
export function BoardStatus({ status, version }: { status: Sandbox['status']; version: string | null }) {
  const schema = useBoardStore((s) => s.schema);
  const visible = useBoardStore((s) => s.visibleTables);
  const loading = status === 'booting' || status === 'restarting' || (status === 'ready' && schema === null);
  const empty = schema !== null && !schema.tables.some((t) => isTableVisible(visible, t.id));
  const label = pgVersionLabel(version);

  return (
    <>
      {loading && (
        <div
          role="status"
          data-testid="board-skeleton"
          className="absolute inset-0 z-10 grid place-items-center bg-background/80"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-start gap-4">
              <Skeleton className="h-28 w-40" />
              <Skeleton className="h-40 w-52" />
              <Skeleton className="h-24 w-36" />
            </div>
            <p className="text-sm text-muted-foreground">Поднимаем Postgres...</p>
          </div>
        </div>
      )}
      {status === 'failed' && (
        <div
          role="alert"
          className="absolute inset-0 z-10 grid place-items-center bg-background/80 text-sm text-destructive"
        >
          Postgres не запустился. Обнови страницу.
        </div>
      )}
      {!loading && status !== 'failed' && empty && (
        <div
          data-testid="board-empty"
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <p className="text-sm text-muted-foreground">
            Создай первую таблицу: <code className="font-mono">create table ...</code>
          </p>
        </div>
      )}
      {label && (
        <Badge
          variant="outline"
          data-testid="pg-version"
          className="absolute right-2 bottom-2 z-10 bg-background"
        >
          {label}
        </Badge>
      )}
    </>
  );
}
