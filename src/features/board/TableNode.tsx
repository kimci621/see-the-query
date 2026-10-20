import { Handle, type NodeProps, Position } from '@xyflow/react';
import { KeyRound, Link2 } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ColumnInfo } from '@/features/db/introspect';
import { plural } from '@/lib/plural';
import { bumpRenderCount } from '@/lib/renderCount';
import { cn } from '@/lib/utils';
import { type AppliedWrite, useBoardStore } from '@/stores/board';
import { CellValue } from './CellValue';
import {
  COLUMN_HEADER_HEIGHT,
  COLUMN_WIDTH,
  foldColumns,
  foldWidth,
  HEADER_HEIGHT,
  MAX_VISIBLE_ROWS,
  ownColumns,
  ROW_HEIGHT,
  STUB_WIDTH,
} from './layout';
import type { TableFlowNode } from './model';

export function columnTitle(c: ColumnInfo): string {
  return [
    `${c.name}: ${c.type}`,
    c.isPk && 'PRIMARY KEY',
    c.fk && `REFERENCES ${c.fk.schema}.${c.fk.table} (${c.fk.column})`,
    !c.nullable && 'NOT NULL',
    c.isUnique && 'UNIQUE',
    c.identity && `GENERATED ${c.identity.toUpperCase()} AS IDENTITY`,
    c.default !== null && `DEFAULT ${c.default}`,
    ...c.checks,
  ]
    .filter(Boolean)
    .join('\n');
}

// Пометка строки по последней записи «Применить», которая её коснулась
function rowMark(xmin: string | undefined, writes: AppliedWrite[]): AppliedWrite['mark'] | undefined {
  if (xmin === undefined || writes.length === 0) return undefined;
  const x = Number(xmin);
  return writes.findLast((w) => x >= w.since)?.mark;
}

const MARK_LABEL = { new: 'Новая строка', changed: 'Изменённая строка' } as const;

// Флаг-сокращение с расшифровкой: title для мыши, abbr для скринридера
function Flag({ title, children }: { title: string; children: ReactNode }) {
  return (
    <abbr title={title} className="rounded border px-0.5 leading-none no-underline">
      {children}
    </abbr>
  );
}

// Подсказка доски (спека 3.4): мышь и фокус с клавиатуры. Только шапки колонок и заглушка, не ячейки
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="font-mono whitespace-pre-line">{text}</TooltipContent>
    </Tooltip>
  );
}

function ColumnHead({ column, highlighted }: { column: ColumnInfo; highlighted: boolean }) {
  return (
    <Hint text={columnTitle(column)}>
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: шапка в порядке Tab ради подсказки с ограничениями
        tabIndex={0}
        data-column={column.name}
        data-highlighted={highlighted || undefined}
        className={cn(
          'vs-col-head flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 last:border-r-0',
          // подложка не плотнее /10: на ней тип колонки 11px держит контраст 4.5 (tests/unit/contrast.test.ts)
          highlighted && 'bg-touched/10',
        )}
        style={{ width: COLUMN_WIDTH }}
      >
        <div className="flex items-center gap-1 text-xs font-medium">
          {column.isPk && <KeyRound aria-label="Первичный ключ" className="size-3 shrink-0" />}
          {column.fk && <Link2 aria-label="Внешний ключ" className="size-3 shrink-0" />}
          <span className="vs-col-name truncate font-mono">{column.name}</span>
        </div>
        <div className="vs-col-meta flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{column.type}</span>
          {!column.nullable && !column.isPk && <Flag title="NOT NULL">NN</Flag>}
          {column.isUnique && !column.isPk && <Flag title="UNIQUE">U</Flag>}
          {column.checks.length > 0 && <Flag title="CHECK">✓</Flag>}
        </div>
      </div>
    </Hint>
  );
}

export const TableNode = memo(function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  bumpRenderCount('tableNode');
  const { table } = data;
  // Селекторы вместо data: при фокусе другой таблицы эта нода не рендерится
  const focused = useBoardStore((s) => s.focused.includes(id));
  const highlighted = useBoardStore(useShallow((s) => ownColumns(s.highlightedColumns, id)));
  const queried = useBoardStore(useShallow((s) => ownColumns(s.queryColumns, id)));
  const expanded = useBoardStore((s) => s.expandedTables.includes(id));
  const writes = useBoardStore((s) => s.rowWrites);
  // Свёртка зависит от колонок запроса, поэтому ширину задаёт нода, а не модель
  const fold = foldColumns(table, queried, expanded);
  const shown = fold.visible.map((c) => ({ c, j: table.columns.indexOf(c) }));
  const stub = fold.hidden.length;
  // Подсвеченная колонка свёрнута: подсвечиваем заглушку, размер ноды не меняется
  const stubHighlighted = fold.hidden.some((c) => highlighted.includes(c.name));
  const rows = table.sampleRows.slice(0, MAX_VISIBLE_ROWS).map((values, i) => ({
    key: table.sampleCtids[i] ?? String(i),
    values,
    mark: rowMark(table.sampleXmins?.[i], writes),
  }));
  const hiddenRows = table.rowCount - rows.length;
  const footer = { height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` };

  return (
    <div
      data-testid={`table-node-${id}`}
      data-focused={focused || undefined}
      className={cn(
        'vs-table h-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm',
        focused && 'ring-2 ring-touched',
      )}
      style={{ width: foldWidth(fold) }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="vs-handle"
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="vs-handle"
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <header
        className="flex items-center justify-between gap-2 border-b px-3"
        style={{ height: HEADER_HEIGHT }}
      >
        <span className="vs-table-name truncate font-mono text-sm font-semibold">
          {table.schema}.{table.name}
        </span>
        <Badge variant="secondary" data-testid="row-count" title="Строк в таблице">
          {table.rowCount}
        </Badge>
      </header>
      <div className="flex border-b bg-muted/50" style={{ height: COLUMN_HEADER_HEIGHT }}>
        {shown.map(({ c }) => (
          <ColumnHead key={c.name} column={c} highlighted={highlighted.includes(c.name)} />
        ))}
        {stub > 0 && (
          <Hint text={fold.hidden.map((c) => c.name).join(', ')}>
            <button
              type="button"
              data-testid="hidden-columns"
              data-highlighted={stubHighlighted || undefined}
              className={cn(
                'vs-col-head flex shrink-0 cursor-pointer items-center px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
                stubHighlighted && 'bg-touched/10',
              )}
              style={{ width: STUB_WIDTH }}
              onClick={(e) => {
                // Тот же путь, что select *: таблица в развёрнутых до следующего запроса.
                // Кнопка исчезнет вместе с заглушкой, фокус остаётся на ноде таблицы
                const node = e.currentTarget.closest<HTMLElement>('.react-flow__node');
                const board = useBoardStore.getState();
                board.expandTables([...board.expandedTables, id]);
                node?.focus();
              }}
            >
              +{stub} {plural(stub, 'колонка', 'колонки', 'колонок')}
            </button>
          </Hint>
        )}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          data-row
          data-mark={row.mark}
          title={row.mark && MARK_LABEL[row.mark]}
          className={cn(
            'vs-rows flex border-b border-border/50 font-mono text-xs',
            row.mark === 'new' && 'bg-new-bg',
            row.mark === 'changed' && 'bg-changed-bg',
          )}
          style={{ height: ROW_HEIGHT }}
        >
          {shown.map(({ c, j }) => (
            <div
              key={c.name}
              className={cn(
                'flex shrink-0 items-center overflow-hidden px-2',
                highlighted.includes(c.name) && 'bg-touched/10',
              )}
              style={{ width: COLUMN_WIDTH }}
            >
              <CellValue value={row.values[j]} type={c.type} />
            </div>
          ))}
          {stub > 0 && <div data-stub-cell className="shrink-0" style={{ width: STUB_WIDTH }} />}
        </div>
      ))}
      {hiddenRows > 0 && (
        <div className="vs-rows px-3 text-xs text-muted-foreground" style={footer}>
          + ещё {hiddenRows}
        </div>
      )}
      {table.rowCount === 0 && (
        <div className="vs-rows px-3 text-xs text-muted-foreground italic" style={footer}>
          пусто
        </div>
      )}
    </div>
  );
});
