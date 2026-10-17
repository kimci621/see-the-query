import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { rowsWord } from '@/features/tracer/captions';
import { useSceneStore } from '@/stores/scene';
import { MessagesList } from './MessagesList';
import { ResultGrid } from './ResultGrid';

// Панель результата: вкладки Результат / Сообщения (План появится в Ф11).
// При stale (недописанный запрос) панель погашена, но не пуста: без мигания.
export function ResultsPanel() {
  const trace = useSceneStore((s) => s.trace);
  const stale = useSceneStore((s) => s.stale);
  const result = trace?.result ?? null;

  const count = result ? (result.rows.length > 0 ? result.rows.length : (result.rowCount ?? 0)) : 0;
  const isDml = result != null && result.command != null && result.command !== 'SELECT';

  return (
    <div
      data-testid="results-panel"
      data-stale={stale || undefined}
      className={stale ? 'h-full opacity-50' : 'h-full'}
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
          {result ? (
            <ResultGrid
              result={result}
              emptyHint={isDml ? `${result.command} не возвращает строк. Затронуто: ${count}` : '0 строк'}
            />
          ) : trace?.error ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Запрос не выполнен, см. «Сообщения»
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Начни печатать запрос
            </div>
          )}
        </TabsContent>
        <TabsContent value="messages" className="mt-0 min-h-0 flex-1">
          <MessagesList trace={trace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
