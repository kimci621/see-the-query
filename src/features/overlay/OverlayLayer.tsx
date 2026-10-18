import { useReactFlow, ViewportPortal } from '@xyflow/react';
import { AnimatePresence, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/stores/board';
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

// Камера сцены двигается, только пока пользователь работает с запросом: фокус в редакторе,
// на доске или в таймлайне. При открытии урока остаётся его сохранённая камера (спека 5.12).
// ponytail: эвристика по фокусу; если не хватит, завести в сторе флаг «сцену запустил пользователь»
const USER_SCENE = '.cm-editor, [data-testid="board-area"], [data-testid="timeline"]';

function userDrivesScene(): boolean {
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
  const rf = useReactFlow();
  const reduced = useReducedMotion() ?? false;
  const lastCamera = useRef('');

  // новая трасса → новое проигрывание
  useEffect(() => {
    const scene = useSceneStore.getState();
    if (!trace || !schema) {
      scene.setPlayback(null);
      return;
    }
    scene.setPlayback(buildPlayback(trace, makeAnimatorContext(rf, schema)));
    // Сцену запустил не пользователь (открытие урока, сохранённый запрос): прячем, доска не гаснет,
    // таймлайн и плеер её вернут
    if (!userDrivesScene()) scene.hide();
  }, [trace, schema, rf]);

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
    void rf.fitBounds(b, { padding: 0.2, duration: durationSec * 1000 });
  }, [phase, followCamera, rf, durationSec]);

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
