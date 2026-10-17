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
  useStore,
} from '@xyflow/react';
import { MapIcon } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useResolvedTheme } from '@/app/ThemeProvider';
import { getLesson } from '@/features/lessons/registry';
import { useBoardStore } from '@/stores/board';
import { useLessonStore } from '@/stores/lesson';
import { useSettingsStore } from '@/stores/settings';
import { FkEdge, FkMarkers } from './FkEdge';
import { FAR_ZOOM, FIT_MIN_ZOOM } from './layout';
import { type BoardNode, buildEdges, buildNodes, normalizeTableId, resolvePositions } from './model';
import { SchemaGroupNode } from './SchemaGroupNode';
import { TableNode } from './TableNode';

// Типы нод и рёбер вне компонента: новый объект на рендер заставляет React Flow пересоздавать ноды
const nodeTypes = { table: TableNode, schemaGroup: SchemaGroupNode };
const edgeTypes = { fk: FkEdge };

// Читаем в момент вызова: пользователь может переключить настройку системы без перезагрузки
const animationMs = (ms: number) => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms);

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
  const resolved = useResolvedTheme();
  const boardRef = useRef<HTMLDivElement>(null);
  const over = useRef(false);
  // Boolean-селектор: ре-рендер только при пересечении порога, а не на каждый кадр зума
  const far = useStore((s) => s.transform[2] < FAR_ZOOM);

  useEffect(() => {
    useBoardStore.getState().setVisibleTables(meta?.board?.tables?.map(normalizeTableId) ?? null);
  }, [meta]);

  // Ноды зависят только от схемы, фильтра и урока; фокус и подсветка их не пересобирают
  const { nodes, edges } = useMemo(() => {
    if (!schema) return { nodes: [], edges: [] };
    const positions = resolvePositions(schema, visible, meta?.board?.layout);
    return { nodes: buildNodes(schema, visible, positions), edges: buildEdges(schema, visible) };
  }, [schema, visible, meta]);

  useCamera(lessonId, nodes, boardRef, over);

  return (
    <div
      ref={boardRef}
      className="vs-board relative h-full w-full"
      data-testid="board-canvas"
      data-dimmed={dimmed || undefined}
      data-far={far || undefined}
      onPointerEnter={() => {
        over.current = true;
      }}
      onPointerLeave={() => {
        over.current = false;
      }}
    >
      <FkMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        colorMode={resolved}
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
      </ReactFlow>
    </div>
  );
}

function useCamera(
  lessonId: string | null,
  nodes: BoardNode[],
  boardRef: RefObject<HTMLDivElement | null>,
  over: RefObject<boolean>,
) {
  const flow = useReactFlow();
  const restoredFor = useRef<string | null>(null);
  const fitRequest = useBoardStore((s) => s.fitRequest);
  const focusRequest = useBoardStore((s) => s.focusRequest);
  const focusMode = useSettingsStore((s) => s.focusMode);
  const prevFocusMode = useRef(focusMode);
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);

  // Сохранённая камера урока ставится один раз; без неё вписываем доску при каждой смене набора нод.
  // useNodesInitialized не годится: при onlyRenderVisibleElements необрисованные ноды не измеряются
  // и initialized не становится true. Ноды несут явные width/height, поэтому fitView работает сразу.
  useEffect(() => {
    if (nodeKey === '') return;
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.viewport : undefined;
    if (!saved) {
      void flow.fitView({ padding: 0.15, minZoom: FIT_MIN_ZOOM });
    } else if (restoredFor.current !== lessonId) {
      restoredFor.current = lessonId;
      void flow.setViewport(saved);
    }
  }, [nodeKey, lessonId, flow]);

  useEffect(() => {
    if (fitRequest > 0)
      void flow.fitView({ padding: 0.15, minZoom: FIT_MIN_ZOOM, duration: animationMs(300) });
  }, [fitRequest, flow]);

  useEffect(() => {
    const ids = useBoardStore.getState().focused;
    if (focusRequest > 0 && ids.length > 0) {
      void flow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.3,
        minZoom: FIT_MIN_ZOOM,
        duration: animationMs(400),
        maxZoom: 1,
      });
    }
  }, [focusRequest, flow]);

  // Режим фокуса меняет размер панели доски: вписываем заново
  useEffect(() => {
    if (prevFocusMode.current === focusMode) return;
    prevFocusMode.current = focusMode;
    void flow.fitView({ padding: 0.15, minZoom: FIT_MIN_ZOOM, duration: animationMs(300) });
  }, [focusMode, flow]);

  // ⌘0 / Ctrl+0: по event.code, на русской раскладке key другой; preventDefault гасит сброс зума браузера.
  // Перехватываем только когда курсор над доской или фокус внутри неё, иначе ломаем сброс зума страницы
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'Digit0') {
        if (!over.current && !boardRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        useBoardStore.getState().requestFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardRef, over]);
}
