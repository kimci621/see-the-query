import { getViewportForBounds, useReactFlow, useStoreApi, ViewportPortal } from '@xyflow/react';
import { AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { chromeBottom } from '@/features/board/layout';
import type { SchemaSnapshot } from '@/features/db/introspect';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { effectiveSpeed, useSceneStore } from '@/stores/scene';
import { makeAnimatorContext } from './context';
import { Decorations } from './Decorations';
import { GhostTableView } from './GhostTable';
import { frameBounds } from './geometry';
import { OverlayErrorBoundary } from './OverlayErrorBoundary';
import { buildPlayback } from './playback';
import './overlay.css';

// Доля длительности фазы, которую занимает движение; остаток пауза, чтобы глаз успел
const MOTION_SHARE = 0.85;
// Растворение призраков, когда сцену прячут или закрывают
const DISSOLVE_SEC = 0.3;
// Пауза перед возвратом камеры к таблицам, когда сцена ушла
const RETURN_DELAY_MS = 800;

// Камера сцены двигается, только пока пользователь работает с запросом: фокус в редакторе,
// на доске или в таймлайне, либо запрос в редактор положила кнопка урока («На доску», шаг сцены, спека 3.3).
// При открытии урока остаётся его сохранённая камера (спека 5.12).
// ponytail: для редактора, доски и таймлайна эвристика по фокусу
const USER_SCENE = '.cm-editor, [data-testid="board-area"], [data-testid="timeline"]';

function userDrivesScene(): boolean {
  const { lessonQuery } = useSceneStore.getState();
  if (lessonQuery !== null && lessonQuery === useEditorStore.getState().text) return true;
  return document.activeElement?.closest(USER_SCENE) != null;
}

export function OverlayLayer() {
  const trace = useSceneStore((s) => s.trace);
  const playback = useSceneStore((s) => s.playback);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const instant = useSceneStore((s) => s.instant);
  const speed = useSceneStore(effectiveSpeed);
  const followCamera = useSceneStore((s) => s.followCamera);
  const stale = useSceneStore((s) => s.stale);
  const hidden = useSceneStore((s) => s.hidden);
  const schema = useBoardStore((s) => s.schema);
  const expanded = useBoardStore((s) => s.expandedTables);
  const builtFor = useRef<{ trace: Trace; schema: SchemaSnapshot } | null>(null);
  const rf = useReactFlow();
  const flowStore = useStoreApi();
  const reduced = useReducedMotion() ?? false;
  const lastCamera = useRef('');

  // новая трасса → новое проигрывание
  useEffect(() => {
    const scene = useSceneStore.getState();
    if (!trace || !schema) {
      builtFor.current = null;
      scene.setPlayback(null);
      return;
    }
    // Призраки свёрнуты как нода: звёздочка трассы и таблицы, развёрнутые кликом по «+N колонки»
    const touched = {
      columns: trace.touched.columns,
      expanded: [...(trace.touched.expanded ?? []), ...expanded],
    };
    const playback = buildPlayback(trace, makeAnimatorContext(rf, schema, touched));
    // Трасса та же, сменилась только свёртка: меняем призраки на месте, шаг и видимость сцены не трогаем
    if (builtFor.current?.trace === trace && builtFor.current.schema === schema) {
      useSceneStore.setState({ playback });
      return;
    }
    builtFor.current = { trace, schema };
    scene.setPlayback(playback);
    // Сцену запустил не пользователь (открытие урока, сохранённый запрос): прячем, доска не гаснет,
    // таймлайн и плеер её вернут
    if (!userDrivesScene()) scene.hide();
  }, [trace, schema, rf, expanded]);

  const active = !!playback && playback.phases.length > 0 && !hidden;

  // пока идёт сцена, базовая доска приглушена (один CSS-класс на контейнере)
  useEffect(() => {
    useBoardStore.getState().setDimmed(active);
    return () => useBoardStore.getState().setDimmed(false);
  }, [active]);

  const phase = active ? playback.phases[Math.min(phaseIndex, playback.phases.length - 1)] : null;
  const durationSec = !phase || instant || reduced ? 0 : ((phase.durationMs / speed) * MOTION_SHARE) / 1000;
  const transitionSec = phase ? durationSec : reduced ? 0 : DISSOLVE_SEC;

  // «камера следит»: вписываем сцену, только если её границы изменились
  useEffect(() => {
    if (!phase || !followCamera || !userDrivesScene()) return;
    const b = frameBounds(phase.frame);
    if (!b) return;
    const key = `${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.width)}:${Math.round(b.height)}`;
    if (key === lastCamera.current) return;
    lastCamera.current = key;
    // Снизу полоса под хром доски, как у focusFrame/boardFrame: fitBounds берёт только число
    const { width, height, minZoom, maxZoom } = flowStore.getState();
    const padding = { x: 0.2, top: 0.2, bottom: chromeBottom() };
    const vp = getViewportForBounds(b, width, height, minZoom, maxZoom, padding);
    void rf.setViewport(vp, { duration: durationSec * 1000 });
  }, [phase, followCamera, rf, flowStore, durationSec]);

  // Сцена ушла (ошибка, итог без шагов, Esc), а камера стоит там, где был призрак: там пусто.
  // Возвращаем её к таблицам запроса, если сцену вёл пользователь (переход в урок держит его камеру).
  // С задержкой: недописанное имя даёт ошибку на миг, новая сцена отменяет полёт
  useEffect(() => {
    if (phase || !lastCamera.current) return;
    lastCamera.current = '';
    if (!followCamera || !userDrivesScene()) return;
    const { fitRequest, startRequest } = useBoardStore.getState();
    const timer = setTimeout(() => {
      // За паузу ученик мог вписать доску (⌘0) или уйти в урок (стартовый кадр): их камеру не перебиваем
      const board = useBoardStore.getState();
      if (board.fitRequest !== fitRequest || board.startRequest !== startRequest || !userDrivesScene())
        return;
      board.requestFrame();
    }, RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, followCamera]);

  // Слой смонтирован всегда: без сцены список таблиц пуст, и AnimatePresence растворяет призраков
  return (
    <ViewportPortal>
      {/* Сбой рендера прячет только сцену: итог запроса в панели результата остаётся */}
      <OverlayErrorBoundary resetKey={trace} onError={() => useSceneStore.getState().hide()}>
        <MotionConfig reducedMotion="user" transition={{ duration: transitionSec, ease: 'easeInOut' }}>
          <div
            className="vs-overlay"
            data-testid="overlay"
            data-stale={stale || undefined}
            // Недописанный запрос: сцена гаснет, но не пропадает, как и панель результата
            style={{ ['--vs-dur' as string]: `${durationSec}s`, opacity: stale ? 0.4 : 1 }}
          >
            <AnimatePresence>
              {phase?.frame.tables.map((t) => (
                <GhostTableView key={t.id} table={t} />
              ))}
            </AnimatePresence>
            {phase ? <Decorations frame={phase.frame} /> : null}
          </div>
        </MotionConfig>
      </OverlayErrorBoundary>
    </ViewportPortal>
  );
}
