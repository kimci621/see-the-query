import { type ReactNode, useRef } from 'react';
import { useBoardStore } from '@/stores/board';

// 'public.book.author_id' → 'public.book'
const tableOf = (columnId: string) => columnId.split('.').slice(0, 2).join('.');

function columnsOfTable(tableId: string): string[] {
  const table = useBoardStore.getState().schema?.tables.find((t) => t.id === tableId);
  return table ? table.columns.map((c) => `${tableId}.${c.name}`) : [];
}

// Колонка плюс колонка, на которую она ссылается по FK: book.author_id тянет за собой author.author_id
function columnWithFk(columnId: string): string[] {
  const tableId = tableOf(columnId);
  const name = columnId.slice(tableId.length + 1);
  const fk = useBoardStore
    .getState()
    .schema?.fks.find((f) => f.from.tableId === tableId && f.from.columns.includes(name));
  const target = fk?.to.columns[fk.from.columns.indexOf(name)];
  return fk && target ? [columnId, `${fk.to.tableId}.${target}`] : [columnId];
}

function Term({
  tableId,
  highlight,
  children,
}: {
  tableId: string;
  highlight: () => string[];
  children: ReactNode;
}) {
  // Подсветка до наведения: вернём её, когда курсор или фокус уйдут
  const previous = useRef<string[] | null>(null);

  const enter = () => {
    const board = useBoardStore.getState();
    if (previous.current === null) previous.current = board.highlightedColumns;
    board.highlightColumns(highlight());
  };
  const leave = () => {
    if (previous.current === null) return;
    useBoardStore.getState().highlightColumns(previous.current);
    previous.current = null;
  };

  return (
    <button
      type="button"
      className="cursor-help font-mono text-[0.9em] underline decoration-dotted underline-offset-4"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onClick={() => useBoardStore.getState().focus([tableId])}
    >
      {children}
    </button>
  );
}

export function T({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Term tableId={id} highlight={() => columnsOfTable(id)}>
      {children}
    </Term>
  );
}

export function C({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Term tableId={tableOf(id)} highlight={() => columnWithFk(id)}>
      {children}
    </Term>
  );
}
