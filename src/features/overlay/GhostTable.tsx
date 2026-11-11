import { AnimatePresence, motion } from 'motion/react';
import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCell } from '@/features/board/format';
import { STUB_WIDTH } from '@/features/board/layout';
import { plural } from '@/lib/plural';
import {
  COL_WIDTH,
  COLHEAD_HEIGHT,
  cellLeft,
  columnKeys,
  columnWidth,
  ghostHeight,
  ghostWidth,
  ROW_H,
  ROW_ICONS,
  rowTop,
  stubLefts,
  TITLE_HEIGHT,
} from './geometry';
import type { GhostColumn, GhostRow, GhostTable } from './types';

// Прозрачность строки по состоянию: через animate, иначе inline opacity motion перебьёт CSS
const STATE_OPACITY: Partial<Record<GhostRow['state'], number>> = {
  cut: 0.35,
  dropped: 0.45,
  unknown: 0.8,
  deleted: 0.45,
};

const GhostRowView = memo(function GhostRowView({
  row,
  index,
  columns,
  keys,
  widths,
  lefts,
  visible,
}: {
  row: GhostRow;
  index: number;
  columns: GhostColumn[];
  keys: string[];
  widths: number[];
  lefts: number[];
  visible: boolean;
}) {
  const icon = ROW_ICONS[row.state];
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
      initial={{
        opacity: 0,
        x: row.origin?.x ?? 0,
        y: row.origin?.y ?? rowTop(index) + (row.state === 'new' ? ROW_H : 0),
      }}
      animate={{ opacity: STATE_OPACITY[row.state] ?? 1, x: 0, y: rowTop(index) }}
      exit={{ opacity: 0, y: rowTop(index) + ROW_H / 2 }}
    >
      <AnimatePresence initial={false}>
        {columns.map((c, ci) => {
          const { text, kind } = formatCell(row.values[ci], c.type);
          return (
            <motion.div
              key={keys[ci]}
              className={`vs-cell vs-col--${c.state}${kind === 'null' ? ' vs-null' : ''}${row.cellMarks?.[ci] ? ` vs-cell--${row.cellMarks[ci]}` : ''}`}
              style={{
                width: widths[ci],
                lineHeight: `${ROW_H}px`,
              }}
              initial={
                c.state === 'added' ? { opacity: 0, x: lefts[ci] + (c.fadeIn ? 0 : COL_WIDTH) } : false
              }
              animate={{ opacity: c.fading ? 0 : c.state === 'removed' ? 0.35 : 1, x: lefts[ci] }}
              exit={{ opacity: 0 }}
              title={row.cellNotes?.[ci] ? `${text}: ${row.cellNotes[ci]}` : text}
              tabIndex={visible && index === 0 && ci === 0 ? 0 : -1}
            >
              {row.cellMarks?.[ci] === 'changed' ? (
                <motion.span
                  key={text}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                >
                  {text}
                </motion.span>
              ) : (
                text
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
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
  const [focusedCell, setFocusedCell] = useState<{ text: string; x: number; y: number } | null>(null);
  const keys = columnKeys(table.columns);
  const widths = table.columns.map((_, ci) => columnWidth(table, ci));
  const lefts = table.columns.map((_, ci) => cellLeft(table, ci));
  const stubs = stubLefts(table);
  return (
    <motion.div
      data-testid="ghost-table"
      data-table-id={table.id}
      className={`vs-ghost${table.dashed ? ' vs-ghost--dashed' : ''}`}
      style={{ width: ghostWidth(table), height: ghostHeight(table) }}
      initial={{ opacity: 0, x: table.x, y: table.y }}
      animate={{ opacity: table.opacity ?? 1, x: table.x, y: table.y }}
      exit={{ opacity: 0 }}
      onFocus={(event) => {
        const cell = (event.target as HTMLElement).closest<HTMLElement>('.vs-cell');
        if (!cell) return;
        const rect = cell.getBoundingClientRect();
        setFocusedCell({
          text: cell.title,
          x: Math.min(rect.left, window.innerWidth - 240),
          y: Math.max(0, rect.top - 36),
        });
      }}
      onBlur={() => setFocusedCell(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('.vs-cell')];
        const index = cells.indexOf(event.target as HTMLElement);
        if (index < 0) return;
        const delta =
          event.key === 'ArrowLeft'
            ? -1
            : event.key === 'ArrowRight'
              ? 1
              : event.key === 'ArrowUp'
                ? -table.columns.length
                : table.columns.length;
        const next = cells[index + delta];
        if (next) next.focus();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {focusedCell &&
        createPortal(
          <div role="tooltip" className="vs-cell-tooltip" style={{ left: focusedCell.x, top: focusedCell.y }}>
            {focusedCell.text}
          </div>,
          document.body,
        )}
      <div className="vs-ghost-title" style={{ height: TITLE_HEIGHT }}>
        {table.title}
      </div>
      <div className="vs-ghost-head" style={{ top: TITLE_HEIGHT, height: COLHEAD_HEIGHT }}>
        <AnimatePresence initial={false}>
          {table.columns.map((c, ci) => (
            <motion.div
              key={keys[ci]}
              className={`vs-colhead vs-col--${c.state}`}
              style={{
                width: widths[ci],
                lineHeight: `${COLHEAD_HEIGHT}px`,
              }}
              initial={
                c.state === 'added' ? { opacity: 0, x: lefts[ci] + (c.fadeIn ? 0 : COL_WIDTH) } : false
              }
              animate={{ opacity: c.fading ? 0 : c.state === 'removed' ? 0.35 : 1, x: lefts[ci] }}
              exit={{ opacity: 0 }}
            >
              {c.name}
            </motion.div>
          ))}
        </AnimatePresence>
        {table.folds?.map((f, i) => (
          <div
            key={f.at}
            data-testid="ghost-folded"
            className="vs-colhead vs-folded"
            style={{
              width: STUB_WIDTH,
              lineHeight: `${COLHEAD_HEIGHT}px`,
              transform: `translateX(${stubs[i]}px)`,
            }}
          >
            +{f.count} {plural(f.count, 'колонка', 'колонки', 'колонок')}
          </div>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {table.rows.map((row, i) => (
          <GhostRowView
            key={row.key}
            row={row}
            index={i}
            columns={table.columns}
            keys={keys}
            widths={widths}
            lefts={lefts}
            visible={table.opacity !== 0}
          />
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
