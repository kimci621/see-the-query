import type { ReactNode } from 'react';
import type { VersionState } from '@/features/db/pageinspect';
import { cn } from '@/lib/utils';

export function MiniTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<{ key: string; cells: ReactNode[]; state?: VersionState }>;
}) {
  return (
    <section aria-label={title} className="min-w-0 overflow-hidden rounded-md border bg-card">
      <h4 className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column} className="px-2 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-state={row.state}
                className={cn(
                  'border-t border-border/60',
                  (row.state === 'dead' || row.state === 'aborted') && 'bg-muted/50 text-muted-foreground',
                  row.state === 'live' && 'bg-green-50/50 dark:bg-green-950/20',
                  row.state === 'locked' && 'bg-amber-100/50 dark:bg-amber-900/20',
                )}
              >
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]}
                    className={cn(
                      'whitespace-nowrap px-2 py-1.5',
                      index < row.cells.length - 1 &&
                        (row.state === 'dead' || row.state === 'aborted') &&
                        'line-through',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Нет строк</p>}
      </div>
    </section>
  );
}
