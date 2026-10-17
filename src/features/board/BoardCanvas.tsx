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

// Подписи React Flow по-русски (ключи из AriaLabelConfig). Описание нод и рёбер заменено:
// стандартное обещает выбор и перенос, а доска только для чтения
const NODE_DESCRIPTION = 'Таблица на доске. Только для просмотра.';
const ariaLabelConfig = {
  'node.a11yDescription.default': NODE_DESCRIPTION,
  'node.a11yDescription.keyboardDisabled': NODE_DESCRIPTION,
  'edge.a11yDescription.default': 'Связь по внешнему ключу. Только для просмотра.',
  'controls.ariaLabel': 'Управление доской',
  'controls.zoomIn.ariaLabel': 'Приблизить',
  'controls.zoomOut.ariaLabel': 'Отдалить',
  'controls.fitView.ariaLabel': 'Вписать доску',
  'minimap.ariaLabel': 'Миникарта доски',
};

// Кадр по таблицам, без рамок схем: рамка резервирует полную ширину свёрнутых таблиц,
// пустой резерв в стартовый кадр не берём
const tablesOf = (nodes: { id: string; type?: string }[]) =>
  nodes.filter((n) => n.type === 'table').map((n) => ({ id: n.id }));

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
        nodesFocusable
        ariaLabelConfig={ariaLabelConfig}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={0.25}
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
        {miniMap && <MiniMap pannable zoomable />}
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
  const pendingFit = useRef(false);
  const width = useStore((s) => s.width);
  const nodeKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);
  // Замеренные ширины таблиц: свёртка меняет их без смены набора нод
  const tableWidths = useStore((s) =>
    [...s.nodeLookup.values()]
      .filter((n) => n.type === 'table')
      .map((n) => `${n.id}:${n.measured.width ?? ''}`)
      .join('|'),
  );
  const knownWidths = useRef(new Map<string, number>());

  // Сохранённая камера урока ставится один раз; без неё вписываем доску при каждой смене набора нод.
  // fitView React Flow сам откладывает до первого замера нод, ещё не замеренные считает по
  // initialWidth и height. useNodesInitialized не годится: при onlyRenderVisibleElements
  // необрисованные ноды не измеряются и initialized не становится true.
  useEffect(() => {
    if (nodeKey === '') return;
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.viewport : undefined;
    if (!saved) {
      void flow.fitView({ nodes: tablesOf(flow.getNodes()), padding: 0.15, minZoom: FIT_MIN_ZOOM });
    } else if (restoredFor.current !== lessonId) {
      restoredFor.current = lessonId;
      void flow.setViewport(saved);
    }
  }, [nodeKey, lessonId, flow]);

  useEffect(() => {
    if (fitRequest > 0)
      void flow.fitView({
        nodes: tablesOf(flow.getNodes()),
        padding: 0.15,
        minZoom: FIT_MIN_ZOOM,
        duration: animationMs(300),
      });
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

  // Свёртка изменила ширину таблицы (разворот по select *): перевписываем камеру, как при фокусе.
  // Первый замер ноды не считается, его вписывает эффект выше
  // biome-ignore lint/correctness/useExhaustiveDependencies: tableWidths служит только триггером, ширины читаем из flow
  useEffect(() => {
    let changed = false;
    for (const { id } of tablesOf(nodes)) {
      const w = flow.getInternalNode(id)?.measured.width;
      if (w === undefined) continue;
      const known = knownWidths.current.get(id);
      if (known !== undefined && known !== w) changed = true;
      knownWidths.current.set(id, w);
    }
    if (!changed) return;
    const ids = useBoardStore.getState().focused;
    void flow.fitView(
      ids.length > 0
        ? {
            nodes: ids.map((id) => ({ id })),
            padding: 0.3,
            minZoom: FIT_MIN_ZOOM,
            duration: animationMs(400),
            maxZoom: 1,
          }
        : { nodes: tablesOf(nodes), padding: 0.15, minZoom: FIT_MIN_ZOOM, duration: animationMs(300) },
    );
  }, [tableWidths, nodes, flow]);

  // Режим фокуса меняет ширину панели доски. Размер контейнера React Flow обновляет ResizeObserver
  // уже после раскладки, поэтому вписываем не сразу, а когда придёт новая ширина
  useEffect(() => {
    if (prevFocusMode.current === focusMode) return;
    prevFocusMode.current = focusMode;
    pendingFit.current = true;
  }, [focusMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: width служит только триггером, в теле не читается
  useEffect(() => {
    if (!pendingFit.current) return;
    pendingFit.current = false;
    void flow.fitView({
      nodes: tablesOf(flow.getNodes()),
      padding: 0.15,
      minZoom: FIT_MIN_ZOOM,
      duration: animationMs(300),
    });
  }, [width, flow]);

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
