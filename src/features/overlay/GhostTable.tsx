import { AnimatePresence, motion } from 'motion/react';
import { memo } from 'react';
import { formatCell } from '@/features/board/format';
import {
  COL_WIDTH,
  COLHEAD_HEIGHT,
  cellLeft,
  columnKeys,
  ghostHeight,
  ghostWidth,
  ROW_H,
  rowTop,
  TITLE_HEIGHT,
} from './geometry';
import type { GhostColumn, GhostRow, GhostTable } from './types';

// Прозрачность строки по состоянию: через animate, иначе inline opacity motion перебьёт CSS
const STATE_OPACITY: Partial<Record<GhostRow['state'], number>> = { cut: 0.35, unknown: 0.8 };

// Иконка состояния: цвет не единственный сигнал
const STATE_ICON: Partial<Record<GhostRow['state'], { icon: string; label: string }>> = {
  kept: { icon: '✓', label: 'прошла' },
  dropped: { icon: '✕', label: 'отсеяна' },
  unknown: { icon: '?', label: 'UNKNOWN' },
  cut: { icon: '✂', label: 'отрезана' },
  new: { icon: '+', label: 'новая' },
  changed: { icon: '~', label: 'изменена' },
  deleted: { icon: '✕', label: 'удалена' },
};

const GhostRowView = memo(function GhostRowView({
  row,
  index,
  columns,
  keys,
}: {
  row: GhostRow;
  index: number;
  columns: GhostColumn[];
  keys: string[];
}) {
  const icon = STATE_ICON[row.state];
  return (
    <motion.div
      data-testid="ghost-row"
      data-row-key={row.key}
      data-state={row.state}
      className={`vs-row vs-row--${row.state}`}
      style={{
        height: ROW_H,
        ...(row.group !== undefined
          ? { ['--vs-group' as string]: `var(--group-${(row.group % 8) + 1})` }
          : {}),
      }}
      initial={{ opacity: 0, y: rowTop(index) }}
      animate={{ opacity: STATE_OPACITY[row.state] ?? 1, y: rowTop(index) }}
      exit={{ opacity: 0, y: rowTop(index) + ROW_H / 2 }}
    >
      {columns.map((c, ci) => {
        const { text, kind } = formatCell(row.values[ci], c.type);
        return (
          <div
            key={keys[ci]}
            className={`vs-cell vs-col--${c.state}${kind === 'null' ? ' vs-null' : ''}`}
            style={{ width: COL_WIDTH, transform: `translateX(${cellLeft(ci)}px)` }}
            title={row.cellNotes?.[ci]}
          >
            {text}
          </div>
        );
      })}
      {icon ? (
        <span className="vs-row-icon" aria-label={icon.label} role="img">
          {icon.icon}
        </span>
      ) : null}
      {row.badge ? <span className="vs-row-badge">{row.badge}</span> : null}
    </motion.div>
  );
});

// Призрачная таблица: двигается целиком, строки двигаются внутри неё
export const GhostTableView = memo(function GhostTableView({ table }: { table: GhostTable }) {
  const keys = columnKeys(table.columns);
  return (
    <motion.div
      data-testid="ghost-table"
      data-table-id={table.id}
      className={`vs-ghost${table.dashed ? ' vs-ghost--dashed' : ''}`}
      style={{ width: ghostWidth(table), height: ghostHeight(table) }}
      initial={{ opacity: 0, x: table.x, y: table.y }}
      animate={{ opacity: table.opacity ?? 1, x: table.x, y: table.y }}
      exit={{ opacity: 0 }}
    >
      <div className="vs-ghost-title" style={{ height: TITLE_HEIGHT }}>
        {table.title}
      </div>
      <div className="vs-ghost-head" style={{ top: TITLE_HEIGHT, height: COLHEAD_HEIGHT }}>
        {table.columns.map((c, ci) => (
          <div
            key={keys[ci]}
            className={`vs-colhead vs-col--${c.state}`}
            style={{ width: COL_WIDTH, transform: `translateX(${cellLeft(ci)}px)` }}
          >
            {c.name}
          </div>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {table.rows.map((row, i) => (
          <GhostRowView key={row.key} row={row} index={i} columns={table.columns} keys={keys} />
        ))}
      </AnimatePresence>
      {table.hiddenRows ? (
        <div
          data-testid="ghost-hidden"
          className="vs-ghost-hidden"
          style={{ top: rowTop(table.rows.length), height: ROW_H }}
        >
          … ещё {table.hiddenRows} строк
        </div>
      ) : null}
    </motion.div>
  );
});
