// biome-ignore-all lint/a11y/useSemanticElements: виртуализация держит строки абсолютно позиционированными div, настоящий <table> тут невозможен
// biome-ignore-all lint/a11y/useFocusableInteractive: фокус нужен только контейнеру прокрутки, строки и ячейки не интерактивны
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: контейнер прокрутки фокусируется ради прокрутки с клавиатуры
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { formatCell } from '@/features/board/format';
import type { QueryResult } from '@/features/db/types';

// OID встроенного типа date: PGlite отдаёт его как Date, без типа ячейка покажет время
const DATE_OID = 1082;

// Виртуализированная таблица результата: моно-шрифт, NULL-плашки как на доске
export function ResultGrid({ result, emptyHint }: { result: QueryResult; emptyHint?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = result.rows;
  // initialRect: jsdom без layout, тесты иначе не увидят ни одной строки
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // оценка для первого кадра; высоту строки замеряет measureElement, при крупном тексте браузера она растёт
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

  // 96px = min-w-24: строка шире панели не сжимает колонки, а прокручивается вместе с шапкой
  const minWidth = result.fields.length * 96;

  return (
    <div data-testid="result-grid" className="h-full min-h-0">
      <div
        ref={scrollRef}
        role="table"
        aria-label="Результат запроса"
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        className="h-full overflow-auto"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 flex w-full border-b bg-muted font-mono text-xs"
          style={{ minWidth }}
        >
          {result.fields.map((f) => (
            <div
              key={f.name}
              role="columnheader"
              data-testid={`field-${f.name}`}
              className="min-w-24 flex-1 truncate px-2 py-1 font-semibold"
              title={f.name}
            >
              {f.name}
            </div>
          ))}
        </div>
        <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                role="row"
                aria-rowindex={item.index + 2}
                data-testid={`row-${item.index}`}
                className="absolute left-0 flex w-full font-mono text-xs hover:bg-muted/50"
                style={{ top: item.start, minWidth }}
              >
                {row.map((cell, i) => (
                  <Cell
                    key={result.fields[i]?.name ?? i}
                    row={item.index}
                    col={i}
                    value={cell}
                    type={result.fields[i]?.dataTypeID === DATE_OID ? 'date' : undefined}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({ row, col, value, type }: { row: number; col: number; value: unknown; type?: string }) {
  const cell = formatCell(value, type);
  return (
    <div
      role="cell"
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
