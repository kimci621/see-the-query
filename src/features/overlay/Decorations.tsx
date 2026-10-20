import { motion } from 'motion/react';
import { rem } from '@/features/board/layout';
import { ghostWidth, ROW_H, rowAnchor, rowTop } from './geometry';
import type { Decoration, Frame, GhostTable } from './types';

function findTable(frame: Frame, id: string): GhostTable | undefined {
  return frame.tables.find((t) => t.id === id);
}

function DecorationView({ d, frame }: { d: Decoration; frame: Frame }) {
  switch (d.kind) {
    case 'scanner': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      return (
        <motion.div
          data-testid="deco-scanner"
          className="vs-scanner"
          style={{ width: ghostWidth(t), x: t.x }}
          initial={false}
          animate={{ x: t.x, y: t.y + rowTop(d.rowIndex) + ROW_H }}
        />
      );
    }
    case 'scissors': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      return (
        <motion.div
          data-testid="deco-scissors"
          className="vs-scissors"
          style={{ width: ghostWidth(t) + rem(1.5) }}
          initial={{ opacity: 0, x: t.x - rem(1.5), y: t.y + rowTop(d.afterRow + 1) }}
          animate={{ opacity: 1, x: t.x - rem(1.5), y: t.y + rowTop(d.afterRow + 1) }}
        >
          <span aria-hidden>✂</span>
        </motion.div>
      );
    }
    case 'counter':
      return (
        <motion.div
          data-testid="deco-counter"
          className="vs-counter"
          initial={{ opacity: 0, x: d.x, y: d.y }}
          animate={{ opacity: 1, x: d.x, y: d.y }}
        >
          {d.text}
        </motion.div>
      );
    case 'bracket': {
      const t = findTable(frame, d.table);
      if (!t) return null;
      const top = t.y + rowTop(d.fromRow);
      const height = (d.toRow - d.fromRow + 1) * ROW_H;
      return (
        <motion.div
          data-testid="deco-bracket"
          className="vs-bracket"
          style={{ height, ['--vs-group' as string]: `var(--group-${(d.color % 8) + 1})` }}
          initial={{ opacity: 0, x: t.x - rem(1.125), y: top }}
          animate={{ opacity: 1, x: t.x - rem(1.125), y: top }}
        >
          {d.label ?? null}
        </motion.div>
      );
    }
    default:
      return null;
  }
}

// Линии пар и стрелки рисуются одним SVG поверх таблиц
function SvgLayer({ frame }: { frame: Frame }) {
  const lines = frame.decorations.flatMap((d) => {
    if (d.kind === 'pair-line') {
      const ft = findTable(frame, d.from.table);
      const tt = findTable(frame, d.to.table);
      if (!ft || !tt) return [];
      // Линия идёт между обращёнными друг к другу краями; ключи подсвечены колонкой 'key'
      const forward = ft.x <= tt.x;
      const a = rowAnchor(ft, d.from.row, forward ? 'right' : 'left');
      const b = rowAnchor(tt, d.to.row, forward ? 'left' : 'right');
      if (!a || !b) return [];
      const mx = (a.x + b.x) / 2;
      return [
        <path
          key={d.id}
          data-testid="deco-pair-line"
          className="vs-pair-line"
          d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
        />,
      ];
    }
    if (d.kind === 'arrow') {
      return [
        <line
          key={d.id}
          data-testid="deco-arrow"
          className={`vs-arrow vs-arrow--${d.tone}`}
          x1={d.from.x}
          y1={d.from.y}
          x2={d.to.x}
          y2={d.to.y}
          markerEnd="url(#vs-arrowhead)"
        />,
      ];
    }
    return [];
  });
  if (lines.length === 0) return null;
  return (
    <svg className="vs-svg-layer" width={1} height={1} overflow="visible" aria-hidden>
      <defs>
        <marker
          id="vs-arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {lines}
    </svg>
  );
}

export function Decorations({ frame }: { frame: Frame }) {
  return (
    <>
      <SvgLayer frame={frame} />
      {frame.decorations.map((d, i) => (
        <DecorationView
          key={'id' in d ? d.id : `${d.kind}:${'table' in d ? d.table : ''}:${i}`}
          d={d}
          frame={frame}
        />
      ))}
    </>
  );
}
