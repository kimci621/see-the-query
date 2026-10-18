import type { SchemaSnapshot } from '@/features/db/introspect';
import type { AnimatorContext } from './types';

export const WORK_AREA_GAP = 160;

// Минимум API React Flow, который нужен аниматорам (удобно подменять в тестах)
export interface FlowApi {
  getInternalNode(id: string):
    | {
        internals: { positionAbsolute: { x: number; y: number } };
        measured: { width?: number; height?: number };
      }
    | undefined;
  getNodes(): unknown[];
  getNodesBounds(nodes: unknown[]): { x: number; y: number; width: number; height: number };
}

export function makeAnimatorContext(api: FlowApi, schema: SchemaSnapshot): AnimatorContext {
  const nodes = api.getNodes();
  const bounds = nodes.length ? api.getNodesBounds(nodes) : null;
  return {
    schema,
    // рабочая зона сцены: свободное место справа от всех таблиц доски
    workArea: bounds ? { x: bounds.x + bounds.width + WORK_AREA_GAP, y: bounds.y } : { x: 0, y: 0 },
    nodeRect(tableId) {
      const n = api.getInternalNode(tableId);
      if (!n) return null;
      return {
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        width: n.measured.width ?? 0,
        height: n.measured.height ?? 0,
      };
    },
  };
}
