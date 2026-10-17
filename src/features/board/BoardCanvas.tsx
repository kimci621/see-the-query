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

// Ключ состояния свёртки: колонки трейса и развёрнутые таблицы. Смена ключа значит, что ширины нод изменятся
const foldKey = () => {
  const { queryColumns, expandedTables } = useBoardStore.getState();
  return `${queryColumns.join()}|${expandedTables.join()}`;
};

// Кадр по таблицам, без рамок схем: рамка резервирует полную ширину свёрнутых таблиц,
// пустой резерв в кадр не берём
const tablesOf = (nodes: { id: string; type?: string }[]) =>
  nodes.filter((n) => n.type === 'table').map((n) => ({ id: n.id }));

// Читаем в момент вызова: пользователь может переключить настройку системы без перезагрузки
const animationMs = (ms: number) => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms);

// Снизу у доски полоса хрома: кнопки зума и плашка версии Postgres (BoardStatus). Кадры держат её
// пустой, чтобы хром не ложился на таблицы. Считаем в rem: плашка растёт вместе с текстом
const chromeBottom = () => {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return `${Math.round(3.5 * rem)}px` as const;
};

// Кадры камеры. Фокус (и стартовый кадр урока): таблицы запроса крупно, не ближе зума 1.
// Отступ 0.1: при 0.3 свёрнутая book (756) на доске 719 px получала зум 0.73 и мелкий текст
const focusFrame = (ids: string[], duration = animationMs(400)) => ({
  nodes: ids.map((id) => ({ id })),
  padding: { x: 0.1, top: 0.1, bottom: chromeBottom() },
  minZoom: FIT_MIN_ZOOM,
  maxZoom: 1,
  duration,
});
// Вся доска: все таблицы с запасом по краям
const boardFrame = (nodes: { id: string; type?: string }[], duration = animationMs(300)) => ({
  nodes: tablesOf(nodes),
  padding: { x: 0.15, top: 0.15, bottom: chromeBottom() },
  minZoom: FIT_MIN_ZOOM,
  duration,
});

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
        {/* Кнопки в строку: вся полоса хрома внизу, её оставляют пустой кадры (chromeBottom) */}
        <Controls
          showInteractive={false}
          position="bottom-left"
          orientation="horizontal"
          fitViewOptions={boardFrame(nodes)}
        >
          <ControlButton
            onClick={() => setMiniMap((v) => !v)}
            title="Миникарта"
            aria-label="Миникарта"
            aria-pressed={miniMap}
          >
            <MapIcon />
          </ControlButton>
        </Controls>
        {/* Справа снизу плашка версии Postgres, миникарта сверху */}
        {miniMap && <MiniMap pannable zoomable position="top-right" />}
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
  const startedFor = useRef<string | null>(null);
  // Свёртка старта урока. Пока свёртка та же (стартовый запрос и его первый трейс), её замер
  // ещё часть старта: сохранённую камеру ученика рефит не трогает (keep), без неё ставит кадр
  // без полёта. null - старт закончился
  const startFold = useRef<{ fold: string; keep: boolean } | null>(null);
  const fitRequest = useBoardStore((s) => s.fitRequest);
  const focusRequest = useBoardStore((s) => s.focusRequest);
  const startRequest = useBoardStore((s) => s.startRequest);
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

  // Стартовый кадр урока (спека 3.4): таблицы стартового запроса (focused от редактора через
  // frameStart), без них вся доска. Ставится без полёта при открытии урока, frameStart и смене набора нод.
  // Сохранённая камера урока важнее стартового кадра, ставится один раз на открытие урока.
  // fitView React Flow сам откладывает до первого замера нод, ещё не замеренные считает по
  // initialWidth и height. useNodesInitialized не годится: при onlyRenderVisibleElements
  // необрисованные ноды не измеряются и initialized не становится true.
  // biome-ignore lint/correctness/useExhaustiveDependencies: startRequest служит только триггером
  useEffect(() => {
    if (nodeKey === '') return;
    const opened = startedFor.current !== lessonId;
    startedFor.current = lessonId;
    const saved = lessonId ? useLessonStore.getState().byId[lessonId]?.viewport : undefined;
    if (saved) {
      if (opened) void flow.setViewport(saved);
      startFold.current = opened || startFold.current?.keep ? { fold: foldKey(), keep: true } : null;
      return;
    }
    startFold.current = { fold: foldKey(), keep: false };
    const all = flow.getNodes();
    const ids = useBoardStore.getState().focused.filter((id) => all.some((n) => n.id === id));
    void flow.fitView(ids.length > 0 ? focusFrame(ids, 0) : boardFrame(all, 0));
  }, [nodeKey, lessonId, startRequest, flow]);

  useEffect(() => {
    if (fitRequest === 0) return;
    startFold.current = null;
    void flow.fitView(boardFrame(flow.getNodes()));
  }, [fitRequest, flow]);

  useEffect(() => {
    const ids = useBoardStore.getState().focused;
    if (focusRequest > 0 && ids.length > 0) {
      startFold.current = null;
      void flow.fitView(focusFrame(ids));
    }
  }, [focusRequest, flow]);

  // Свёртка изменила ширину таблицы (разворот по select *): перевписываем камеру, как при фокусе.
  // Цель рефита - frameTarget: при смене урока это новый стартовый кадр. Первый замер ноды
  // не считается, его вписывает эффект выше. Свёртку старта при сохранённой камере не вписываем,
  // без сохранённой вписываем без полёта: select * стартового запроса разворачивает таблицу уже после кадра
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
    const start = startFold.current?.fold === foldKey() ? startFold.current : null;
    if (!changed || start?.keep) return;
    if (!start) startFold.current = null;
    const ids = useBoardStore.getState().frameTarget;
    const duration = start ? 0 : undefined;
    void flow.fitView(ids.length > 0 ? focusFrame(ids, duration) : boardFrame(nodes, duration));
  }, [tableWidths, nodes, flow]);

  // Режим фокуса меняет ширину панели доски. Размер контейнера React Flow обновляет ResizeObserver
  // уже после раскладки, поэтому вписываем не сразу, а когда придёт новая ширина. Кадр тот же,
  // что при развороте: таблицы запроса крупно, без них вся доска
  useEffect(() => {
    if (prevFocusMode.current === focusMode) return;
    prevFocusMode.current = focusMode;
    pendingFit.current = true;
  }, [focusMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: width служит только триггером, в теле не читается
  useEffect(() => {
    if (!pendingFit.current) return;
    pendingFit.current = false;
    startFold.current = null;
    const ids = useBoardStore.getState().frameTarget;
    void flow.fitView(ids.length > 0 ? focusFrame(ids) : boardFrame(flow.getNodes()));
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
