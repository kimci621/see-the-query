import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { DbError } from '@/features/db/types';
import { applyFix } from '@/features/editor/diagnostics';
import { useTypingError } from '@/features/editor/useTypingError';
import { explainError } from '@/features/errors/explain';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';

// Карточка ошибки: объяснение словаря, подсказка, правка в один клик и оригинал Postgres
// (оригинал всегда в DOM, свёрнут под «Текст Postgres», спека 5.14).
// sql - оператор, к которому относится position. parse - ошибка разбора недописанного текста.
// Разбор и имя на полуслове показываем нейтрально, как плашку «Недописан»: краснеть рано
export function ErrorCard({ error, sql, parse = false }: { error: DbError; sql: string; parse?: boolean }) {
  const schema = useBoardStore((s) => s.schema);
  const text = useEditorStore((s) => s.text);
  const explanation = useMemo(() => explainError(error, { sql, schema }), [error, sql, schema]);
  const { fix } = explanation;
  // кнопка есть, только когда правка применима к текущему тексту
  const fixed = fix ? applyFix(text, sql, error, fix) : null;
  const showFix = fix != null && fixed != null;
  const typing = useTypingError(error.code);
  const neutral = parse || typing;

  return (
    <div
      data-testid="pg-error"
      data-tone={neutral ? 'neutral' : 'error'}
      className={cn(
        'rounded-md border p-2 text-sm',
        neutral ? 'bg-muted/40' : 'border-destructive/40 bg-destructive/10',
      )}
    >
      <p data-testid="pg-explain-title" className={cn('font-semibold', !neutral && 'text-destructive')}>
        {explanation.title}
        <span className="ml-2 font-mono text-xs font-normal">{error.code}</span>
      </p>
      {explanation.body && (
        <p data-testid="pg-explain-body" className="mt-1">
          {explanation.body}
        </p>
      )}
      {(explanation.suggestion || showFix) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {explanation.suggestion && (
            <p data-testid="pg-explain-suggestion" className="text-muted-foreground">
              {explanation.suggestion}
            </p>
          )}
          {showFix && (
            <Button
              size="xs"
              variant="outline"
              data-testid="pg-fix-button"
              onClick={() => useEditorStore.getState().setText(fixed)}
            >
              Заменить на {fix.to}
            </Button>
          )}
        </div>
      )}
      {/* оригинал свёрнут, но остаётся в DOM: скринридер и поиск его находят */}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Текст Postgres</summary>
        <pre
          data-testid="pg-original"
          className="mt-1 overflow-auto rounded bg-muted/60 p-2 font-mono whitespace-pre-wrap"
        >
          {error.message}
        </pre>
      </details>
    </div>
  );
}
