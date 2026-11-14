import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type DbError, hasRowCount } from '@/features/db/types';
import { explainError } from '@/features/errors/explain';
import { emptyResultHint } from '@/features/overlay/emptyHint';
import { useMessages } from '@/hooks/use-messages';
import { message } from '@/lib/messages';
import { rowsWord } from '@/lib/plural';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { useSettingsStore } from '@/stores/settings';
import { ErrorCard } from './ErrorCard';
import { MessagesList } from './MessagesList';
import { PlanTree } from './PlanTree';
import { ResultGrid } from './ResultGrid';

// Панель результата: вкладки Результат, Сообщения и доступный план.
// При stale (недописанный запрос) панель погашена, но не пуста: без мигания.
export function ResultsPanel() {
  const locale = useSettingsStore((s) => s.locale);
  const t = useMessages();
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
  // у DDL числа строк нет: «CREATE: 0» вводит в заблуждение
  const counted = hasRowCount(result?.command);
  const schema = useBoardStore((s) => s.schema);

  // Что озвучить скринридеру: итог выполнения или заголовок ошибки (ErrorCard сам не role="alert")
  const spoken = useMemo(() => {
    const err = parseDbError
      ? { error: parseDbError, sql: text }
      : trace?.error
        ? { error: trace.error, sql: trace.sql }
        : null;
    if (err)
      return `${message(locale, 'Ошибка')}: ${explainError(err.error, { sql: err.sql, schema, locale }).title}`;
    if (result)
      return isDml
        ? counted
          ? `${result.command}: ${count}`
          : (result.command ?? '')
        : rowsWord(count, locale);
    return '';
  }, [parseDbError, text, trace, schema, result, isDml, counted, count, locale]);
  // Задержка 1000 мс: пока человек печатает, превью пересчитывается на каждый символ, а объявлять нужно итог
  const [announced, setAnnounced] = useState('');
  const [tab, setTab] = useState('result');
  useEffect(() => {
    if (!trace?.plan) setTab((current) => (current === 'plan' ? 'result' : current));
  }, [trace?.plan]);
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(spoken), 1000);
    return () => clearTimeout(t);
  }, [spoken]);

  return (
    <div
      data-testid="results-panel"
      data-stale={stale || undefined}
      className={stale && !parseDbError ? 'h-full opacity-50' : 'h-full'}
    >
      <p data-testid="results-live" aria-live="polite" className="sr-only">
        {announced}
      </p>
      <Tabs
        value={tab === 'plan' && !trace?.plan ? 'result' : tab}
        onValueChange={(value) => {
          if (value !== 'plan') useSceneStore.getState().setHoveredStage(null);
          setTab(value);
        }}
        className="flex h-full flex-col"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
          <TabsList className="h-7">
            <TabsTrigger value="result" className="text-xs">
              {t('Результат')}
            </TabsTrigger>
            <TabsTrigger value="messages" className="text-xs">
              {t('Сообщения')}
            </TabsTrigger>
            {trace?.plan && (
              <TabsTrigger value="plan" className="text-xs">
                {t('План')}
              </TabsTrigger>
            )}
          </TabsList>
          {result && (
            <Badge variant="secondary" data-testid="result-count">
              {isDml ? (counted ? `${result.command}: ${count}` : result.command) : rowsWord(count, locale)}
            </Badge>
          )}
          {trace && (
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {trace.timingMs} {locale === 'en' ? 'ms' : 'мс'}
            </span>
          )}
        </div>
        <TabsContent value="result" tabIndex={-1} className="mt-0 min-h-0 flex-1">
          {parseDbError ? (
            <div className="h-full overflow-auto p-2">
              <ErrorCard error={parseDbError} sql={text} parse />
            </div>
          ) : result ? (
            <ResultGrid
              result={result}
              // Под «0 строк» подсказка, на каком шаге запрос потерял все строки
              emptyHint={
                isDml
                  ? locale === 'en'
                    ? `${result.command} does not return rows.${counted ? ` Rows affected: ${count}` : ''}`
                    : `${result.command} не возвращает строк.${counted ? ` Затронуто: ${count}` : ''}`
                  : [rowsWord(0, locale), trace && emptyResultHint(trace, locale)].filter(Boolean).join('. ')
              }
            />
          ) : trace?.error ? (
            <div className="h-full overflow-auto p-2">
              <ErrorCard error={trace.error} sql={trace.sql} />
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              {t('Начни печатать запрос')}
            </div>
          )}
        </TabsContent>
        {trace?.plan && (
          <TabsContent value="plan" tabIndex={-1} className="mt-0 min-h-0 flex-1">
            <PlanTree plan={trace.plan} stages={trace.stages} />
          </TabsContent>
        )}
        <TabsContent value="messages" tabIndex={-1} className="mt-0 min-h-0 flex-1">
          <MessagesList trace={trace} parseError={parseDbError ? { error: parseDbError, sql: text } : null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
