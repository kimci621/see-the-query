import { Handle, type NodeProps, Position } from '@xyflow/react';
import { KeyRound, Link2 } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Badge } from '@/components/ui/badge';
import type { ColumnInfo } from '@/features/db/introspect';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';
import { CellValue } from './CellValue';
import { COLUMN_HEADER_HEIGHT, COLUMN_WIDTH, HEADER_HEIGHT, MAX_VISIBLE_ROWS, ROW_HEIGHT } from './layout';
import { type TableFlowNode, tableAriaLabel } from './model';

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

// Имена колонок этой таблицы из списка 'public.book.title'
function ownColumns(all: string[], tableId: string): string[] {
  const prefix = `${tableId}.`;
  return all.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
}

// Флаг-сокращение с расшифровкой: title для мыши, abbr для скринридера
function Flag({ title, children }: { title: string; children: ReactNode }) {
  return (
    <abbr title={title} className="rounded border px-0.5 leading-none no-underline">
      {children}
    </abbr>
  );
}

function ColumnHead({ column, highlighted }: { column: ColumnInfo; highlighted: boolean }) {
  return (
    <div
      data-column={column.name}
      data-highlighted={highlighted || undefined}
      title={columnTitle(column)}
      className={cn(
        'flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 last:border-r-0',
        highlighted && 'bg-touched/15',
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
  );
}

export const TableNode = memo(function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  const { table } = data;
  // Селекторы вместо data: при фокусе другой таблицы эта нода не рендерится
  const focused = useBoardStore((s) => s.focused.includes(id));
  const highlighted = useBoardStore(useShallow((s) => ownColumns(s.highlightedColumns, id)));
  const rows = table.sampleRows
    .slice(0, MAX_VISIBLE_ROWS)
    .map((values, i) => ({ key: table.sampleCtids[i] ?? String(i), values }));
  const hidden = table.rowCount - rows.length;
  const footer = { height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` };

  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset ломает раскладку ноды, группа нужна только ради подписи
    <div
      data-testid={`table-node-${id}`}
      role="group"
      aria-label={tableAriaLabel(table)}
      data-focused={focused || undefined}
      className={cn(
        'vs-table h-full w-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm',
        focused && 'ring-2 ring-touched',
      )}
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
        {table.columns.map((c) => (
          <ColumnHead key={c.name} column={c} highlighted={highlighted.includes(c.name)} />
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="vs-rows flex border-b border-border/50 font-mono text-xs"
          style={{ height: ROW_HEIGHT }}
        >
          {table.columns.map((c, j) => (
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
        </div>
      ))}
      {hidden > 0 && (
        <div className="vs-rows px-3 text-xs text-muted-foreground" style={footer}>
          + ещё {hidden}
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
