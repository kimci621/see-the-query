import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { stageLabel } from '@/features/overlay/labels';
import { lastPhaseOfStage, stageOfPhase } from '@/features/overlay/playback';
import { useSceneStore } from '@/stores/scene';
import { usePlayer } from './usePlayer';

export function Timeline() {
  usePlayer();
  const trace = useSceneStore((s) => s.trace);
  const playback = useSceneStore((s) => s.playback);
  const phaseIndex = useSceneStore((s) => s.phaseIndex);
  const playing = useSceneStore((s) => s.playing);
  const speed = useSceneStore((s) => s.speed);
  const autoplay = useSceneStore((s) => s.autoplay);
  const followCamera = useSceneStore((s) => s.followCamera);
  const store = useSceneStore.getState;
  const activeStage = playback ? stageOfPhase(playback, phaseIndex) : -1;
  const chipsRef = useRef<HTMLOListElement>(null);

  // Лента чипов прокручивается по горизонтали: держим активный чип в видимой части
  useEffect(() => {
    const list = chipsRef.current;
    const chip = list?.children[activeStage] as HTMLElement | undefined;
    if (list && chip) list.scrollLeft = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
  }, [activeStage]);

  if (!trace) {
    return (
      <div data-testid="timeline" className="flex h-full items-center px-3 text-sm text-muted-foreground">
        Напиши запрос, и здесь появятся шаги его выполнения
      </div>
    );
  }

  // У ошибки со сценой (42803) плеер как у обычной трассы
  if (trace.mode === 'final-only' && !playback?.phases.length) {
    return (
      <div data-testid="timeline" className="flex h-full items-center px-3 text-sm">
        <p data-testid="final-only-note" aria-live="polite">
          {trace.error
            ? 'Запрос завершился ошибкой, см. «Сообщения»'
            : (trace.fallbackReason ?? 'Пошаговый разбор для этой конструкции пока не умею')}
        </p>
      </div>
    );
  }

  const phases = playback?.phases ?? [];
  const current = phases[phaseIndex];

  return (
    <div data-testid="timeline" className="flex h-full flex-col gap-1 px-3 py-1">
      <div className="flex items-center gap-2">
        {/* Одна строка при любом числе стадий: перенос выталкивал подпись под редактор (P8.38) */}
        <ol
          ref={chipsRef}
          className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]"
          aria-label="Шаги выполнения запроса"
        >
          {trace.stages.map((stage, i) => (
            <li key={stage.id} className="shrink-0">
              <button
                type="button"
                data-testid="stage-chip"
                data-active={i === activeStage}
                aria-current={i === activeStage ? 'step' : undefined}
                className="rounded-md border px-2 py-0.5 font-mono text-xs data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                // Значения volatile-функций посчитаны один раз и могут отличаться от панели результата (спека 5.6)
                title={
                  stage.volatile
                    ? 'Есть volatile-функция: значения на доске и в результате могут различаться'
                    : undefined
                }
                onClick={() => playback && store().seek(lastPhaseOfStage(playback, i))}
              >
                {stage.volatile ? `${stageLabel(stage)} ~` : stageLabel(stage)}
              </button>
            </li>
          ))}
        </ol>
        <Button
          data-testid="player-prev"
          size="icon"
          variant="ghost"
          aria-label="Шаг назад"
          onClick={() => store().step(-1)}
        >
          <SkipBack />
        </Button>
        <Button
          data-testid="player-toggle"
          size="icon"
          variant="ghost"
          aria-label={playing ? 'Пауза' : 'Играть'}
          onClick={() => store().toggle()}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          data-testid="player-next"
          size="icon"
          variant="ghost"
          aria-label="Шаг вперёд"
          onClick={() => store().step(1)}
        >
          <SkipForward />
        </Button>
        <ToggleGroup
          type="single"
          size="sm"
          value={String(speed)}
          onValueChange={(v) => v && store().setSpeed(Number(v) as 0.5 | 1 | 2)}
          aria-label="Скорость"
        >
          <ToggleGroupItem value="0.5">0.5x</ToggleGroupItem>
          <ToggleGroupItem value="1">1x</ToggleGroupItem>
          <ToggleGroupItem value="2">2x</ToggleGroupItem>
        </ToggleGroup>
        <Button
          size="sm"
          variant={autoplay ? 'secondary' : 'ghost'}
          aria-pressed={autoplay}
          onClick={() => store().setAutoplay(!autoplay)}
        >
          Автоплей
        </Button>
        <Button
          size="sm"
          variant={followCamera ? 'secondary' : 'ghost'}
          aria-pressed={followCamera}
          onClick={() => store().setFollowCamera(!followCamera)}
        >
          Камера следит
        </Button>
      </div>
      {phases.length > 1 ? (
        <Slider
          data-testid="player-scrub"
          min={0}
          max={phases.length - 1}
          step={1}
          value={[phaseIndex]}
          onValueChange={(v) => store().seek(v[0] ?? 0)}
          aria-label="Позиция в сцене"
        />
      ) : null}
      <p data-testid="timeline-caption" aria-live="polite" className="truncate text-sm">
        {current?.caption ?? ''}
      </p>
    </div>
  );
}
