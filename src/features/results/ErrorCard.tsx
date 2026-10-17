import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { DbError } from '@/features/db/types';
import { applyFix } from '@/features/editor/diagnostics';
import { explainError } from '@/features/errors/explain';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';

// Карточка ошибки: объяснение словаря, подсказка, правка в один клик и оригинал Postgres
// (оригинал всегда рядом, спека 5.14). sql - оператор, к которому относится position.
export function ErrorCard({ error, sql }: { error: DbError; sql: string }) {
  const schema = useBoardStore((s) => s.schema);
  const text = useEditorStore((s) => s.text);
  const explanation = useMemo(() => explainError(error, { sql, schema }), [error, sql, schema]);
  const { fix } = explanation;
  // кнопка есть, только когда правка применима к текущему тексту
  const fixed = fix ? applyFix(text, sql, error, fix) : null;

  return (
    <div
      data-testid="pg-error"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm"
    >
      <p data-testid="pg-explain-title" className="font-semibold text-destructive">
        {explanation.title}
        <span className="ml-2 font-mono text-xs font-normal">{error.code}</span>
      </p>
      <p data-testid="pg-explain-body" className="mt-1">
        {explanation.body}
      </p>
      {explanation.suggestion && (
        <p data-testid="pg-explain-suggestion" className="mt-1 text-muted-foreground">
          {explanation.suggestion}
        </p>
      )}
      {fix && fixed != null && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          data-testid="pg-fix-button"
          onClick={() => useEditorStore.getState().setText(fixed)}
        >
          Заменить на {fix.to}
        </Button>
      )}
      <pre
        data-testid="pg-original"
        className="mt-2 overflow-auto rounded bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
      >
        {error.message}
      </pre>
    </div>
  );
}
