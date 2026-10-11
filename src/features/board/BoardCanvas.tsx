import '@xyflow/react/dist/style.css';
import './board.css';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { MapIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { getLesson } from '@/features/lessons/registry';
import { OverlayLayer } from '@/features/overlay/OverlayLayer';
import { useBoardStore } from '@/stores/board';
import { useLessonStore } from '@/stores/lesson';
import { FkEdge, FkMarkers } from './FkEdge';
import { type BoardNode, buildEdges, buildNodes, normalizeTableId, resolvePositions } from './model';
import { SchemaGroupNode } from './SchemaGroupNode';
import { TableNode } from './TableNode';

// Типы нод и рёбер вне компонента: новый объект на рендер заставляет React Flow пересоздавать ноды
const nodeTypes = { table: TableNode, schemaGroup: SchemaGroupNode };
const edgeTypes = { fk: FkEdge };

export function BoardCanvas() {
  return (
    <ReactFlowProvider>
      <BoardFlow />
    </ReactFlowProvider>
  );
}

function BoardFlow() {
  const { lessonId = null } = useParams();
  const meta = lessonId ? getLesson(lessonId) : undefined;
  const schema = useBoardStore((s) => s.schema);
  const visible = useBoardStore((s) => s.visibleTables);
  const dimmed = useBoardStore((s) => s.dimmed);
  const [miniMap, setMiniMap] = useState(false);

  useEffect(() => {
    useBoardStore.getState().setVisibleTables(meta?.board?.tables?.map(normalizeTableId) ?? null);
  }, [meta]);

  // Ноды зависят только от схемы, фильтра и урока; фокус и подсветка их не пересобирают
  const { nodes, edges } = useMemo(() => {
    if (!schema) return { nodes: [], edges: [] };
    const positions = resolvePositions(schema, visible, meta?.board?.layout);
    return { nodes: buildNodes(schema, visible, positions), edges: buildEdges(schema, visible) };
  }, [schema, visible, meta]);

  useCamera(lessonId, nodes);

  return (
    <div
      className="vs-board relative h-full w-full"
      data-testid="board-canvas"
      data-dimmed={dimmed || undefined}
    >
      <FkMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onlyRenderVisibleElements
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2}
        onMoveEnd={(event, viewport) => {
          // event = null у программных движений (fitView), их не запоминаем
          if (event && lessonId) useLessonStore.getState().setViewport(lessonId, viewport);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--board-dot)" />
        <Controls showInteractive={false} position="bottom-left">
          <ControlButton
            onClick={() => setMiniMap((v) => !v)}
            title="Миникарта"
            aria-label="Миникарта"
            aria-pressed={miniMap}
          >
            <MapIcon />
          </ControlButton>
        </Controls>
        {miniMap && <MiniMap pannable zoomable ariaLabel="Миникарта доски" />}
        <OverlayLayer />
      </ReactFlow>
    </div>
  );
}

function useCamera(lessonId: string | null, nodes: BoardNode[]) {
  const flow = useReactFlow();
  const restoredFor = useRef<string | null>(null);
  const fitRequest = useBoardStore((s) => s.fitRequest);
  const focusRequest = useBoardStore((s) => s.focusRequest);
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);

  // Сохранённая камера урока ставится один раз; без неё вписываем доску при каждой смене набора нод.
  // useNodesInitialized не годится: при onlyRenderVisibleElements необрисованные ноды не измеряются
  // и initialized не становится true. Ноды несут явные width/height, поэтому fitView работает сразу.
  useEffect(() => {
    if (nodeKey === '') return;
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.viewport : undefined;
    if (!saved) {
      void flow.fitView({ padding: 0.15 });
    } else if (restoredFor.current !== lessonId) {
      restoredFor.current = lessonId;
      void flow.setViewport(saved);
    }
  }, [nodeKey, lessonId, flow]);

  useEffect(() => {
    if (fitRequest > 0) void flow.fitView({ padding: 0.15, duration: 300 });
  }, [fitRequest, flow]);

  useEffect(() => {
    const ids = useBoardStore.getState().focused;
    if (focusRequest > 0 && ids.length > 0) {
      void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.3, duration: 400, maxZoom: 1 });
    }
  }, [focusRequest, flow]);

  // ⌘0 / Ctrl+0: по event.code, на русской раскладке key другой; preventDefault гасит сброс зума браузера
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'Digit0') {
        e.preventDefault();
        useBoardStore.getState().requestFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
