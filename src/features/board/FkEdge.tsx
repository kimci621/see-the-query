import { BaseEdge, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { memo } from 'react';
import type { FkInfo } from '@/features/db/introspect';
import type { FkFlowEdge } from './model';

export function fkTitle(fk: FkInfo): string {
  return [
    fk.name,
    `${fk.from.tableId} (${fk.from.columns.join(', ')}) → ${fk.to.tableId} (${fk.to.columns.join(', ')})`,
    `ON DELETE ${fk.onDelete}`,
    `ON UPDATE ${fk.onUpdate}`,
  ].join('\n');
}

// FK на свою же таблицу: выходим вправо, поднимаемся над шапкой и входим слева
export function selfLoopPath(sx: number, sy: number, tx: number, ty: number): string {
  return `M ${sx} ${sy} H ${sx + 24} V ${sy - 40} H ${tx - 24} V ${ty} H ${tx}`;
}

export const FkEdge = memo(function FkEdge(props: EdgeProps<FkFlowEdge>) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const path =
    source === target
      ? selfLoopPath(sourceX, sourceY, targetX, targetY)
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: 12,
        })[0];
  return (
    <g className="vs-fk">
      {data && <title>{fkTitle(data.fk)}</title>}
      <BaseEdge
        path={path}
        className="vs-fk-path"
        markerStart="url(#vs-fk-one)"
        markerEnd="url(#vs-fk-many)"
        interactionWidth={16}
      />
    </g>
  );
});

// «Воронья лапка» (много) у таблицы с FK, черта (один) у таблицы, на которую ссылаются
export function FkMarkers() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute size-0">
      <defs>
        <marker
          id="vs-fk-many"
          viewBox="0 0 12 12"
          refX="12"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 6 L 12 0 M 0 6 L 12 6 M 0 6 L 12 12" className="vs-fk-marker" />
        </marker>
        <marker
          id="vs-fk-one"
          viewBox="0 0 12 12"
          refX="0"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 6 0 L 6 12" className="vs-fk-marker" />
        </marker>
      </defs>
    </svg>
  );
}
