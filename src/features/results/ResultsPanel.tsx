import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DbError } from '@/features/db/types';
import { rowsWord } from '@/features/tracer/captions';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { ErrorCard } from './ErrorCard';
import { MessagesList } from './MessagesList';
import { ResultGrid } from './ResultGrid';

// Панель результата: вкладки Результат / Сообщения (План появится в Ф11).
// При stale (недописанный запрос) панель погашена, но не пуста: без мигания.
export function ResultsPanel() {
  const sceneTrace = useSceneStore((s) => s.trace);
  const stale = useSceneStore((s) => s.stale);
  const text = useEditorStore((s) => s.text);
  const parseError = useEditorStore((s) => s.parseError);
  // недописанный запрос: показываем ошибку разбора, а не результат прошлого запроса;
  // position разбора 0-based, у DbError 1-based
  const parseDbError = useMemo<DbError | null>(
    () =>
      stale && parseError
        ? { code: '42601', message: parseError.message, position: parseError.position + 1 }
        : null,
    [stale, parseError],
  );
  const trace = parseDbError ? null : sceneTrace;
  const result = trace?.result ?? null;

  const count = result ? (result.rows.length > 0 ? result.rows.length : (result.rowCount ?? 0)) : 0;
  const isDml = result != null && result.command != null && result.command !== 'SELECT';

  return (
    <div
      data-testid="results-panel"
      data-stale={stale || undefined}
      className={stale && !parseDbError ? 'h-full opacity-50' : 'h-full'}
    >
      <Tabs defaultValue="result" className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
          <TabsList className="h-7">
            <TabsTrigger value="result" className="text-xs">
              Результат
            </TabsTrigger>
            <TabsTrigger value="messages" className="text-xs">
              Сообщения
            </TabsTrigger>
          </TabsList>
          {result && (
            <Badge variant="secondary" data-testid="result-count">
              {isDml ? `${result.command}: ${count}` : rowsWord(count)}
            </Badge>
          )}
          {trace && (
            <span className="ml-auto font-mono text-xs text-muted-foreground">{trace.timingMs} мс</span>
          )}
        </div>
        <TabsContent value="result" className="mt-0 min-h-0 flex-1">
          {parseDbError ? (
            <div className="h-full overflow-auto p-2">
              <ErrorCard error={parseDbError} sql={text} />
            </div>
          ) : result ? (
            <ResultGrid
              result={result}
              emptyHint={isDml ? `${result.command} не возвращает строк. Затронуто: ${count}` : '0 строк'}
            />
          ) : trace?.error ? (
            <div className="h-full overflow-auto p-2">
              <ErrorCard error={trace.error} sql={trace.sql} />
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Начни печатать запрос
            </div>
          )}
        </TabsContent>
        <TabsContent value="messages" className="mt-0 min-h-0 flex-1">
          <MessagesList trace={trace} parseError={parseDbError ? { error: parseDbError, sql: text } : null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
