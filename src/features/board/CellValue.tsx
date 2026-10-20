import { memo } from 'react';
import { formatCell } from './format';

// NULL: серая плашка курсивом с пунктиром; '' приглушённо, чтобы их не путали
export const CellValue = memo(function CellValue({ value, type }: { value: unknown; type?: string }) {
  const cell = formatCell(value, type);
  if (cell.kind === 'null') {
    return (
      <span
        data-kind="null"
        className="rounded border border-dashed border-null bg-null-bg px-1 text-[0.6875rem] leading-4 text-null italic"
      >
        NULL
      </span>
    );
  }
  if (cell.kind === 'empty') {
    return (
      <span data-kind="empty" title="Пустая строка" className="text-muted-foreground">
        {cell.text}
      </span>
    );
  }
  return (
    <span data-kind="value" className="truncate" title={cell.text}>
      {cell.text}
    </span>
  );
});
