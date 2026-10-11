import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { formatCell } from '@/features/board/format';
import type { QueryResult } from '@/features/db/types';

// Виртуализированная таблица результата: моно-шрифт, NULL-плашки как на доске
export function ResultGrid({ result, emptyHint }: { result: QueryResult; emptyHint?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = result.rows;
  // initialRect: jsdom без layout, тесты иначе не увидят ни одной строки
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
    initialRect: { width: 800, height: 400 },
  });

  if (rows.length === 0) {
    return (
      <div data-testid="result-grid" className="grid h-full place-items-center">
        <p data-testid="result-empty" className="text-sm text-muted-foreground">
          {emptyHint ?? '0 строк'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="result-grid" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b bg-muted/40 font-mono text-xs">
        {result.fields.map((f) => (
          <div
            key={f.name}
            data-testid={`field-${f.name}`}
            className="min-w-24 flex-1 truncate px-2 py-1 font-semibold"
            title={f.name}
          >
            {f.name}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                data-testid={`row-${item.index}`}
                className="absolute left-0 flex w-full font-mono text-xs hover:bg-muted/50"
                style={{ top: item.start, height: item.size }}
              >
                {row.map((cell, i) => (
                  <Cell key={result.fields[i]?.name ?? i} row={item.index} col={i} value={cell} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({ row, col, value }: { row: number; col: number; value: unknown }) {
  const cell = formatCell(value);
  return (
    <div
      data-testid={`cell-${row}-${col}`}
      data-kind={cell.kind}
      className="min-w-24 flex-1 truncate px-2 py-1.5"
      title={cell.text}
    >
      {cell.kind === 'null' ? (
        <span className="italic text-muted-foreground">NULL</span>
      ) : cell.kind === 'empty' ? (
        <span className="italic text-muted-foreground">''</span>
      ) : (
        cell.text
      )}
    </div>
  );
}
