import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace, testCtx } from '@/features/overlay/__fixtures__/traces';
import { buildPlayback } from '@/features/overlay/playback';
import { useSceneStore } from '@/stores/scene';
import { Timeline } from './Timeline';

function load(autoplay = false) {
  const trace = fullPipelineTrace();
  const s = useSceneStore.getState();
  s.setAutoplay(autoplay);
  s.setTrace(trace, s.nextGeneration());
  useSceneStore.getState().setPlayback(buildPlayback(trace, testCtx()));
}

describe('Timeline', () => {
  beforeEach(() => useSceneStore.setState(useSceneStore.getInitialState(), true));

  it('чипы стадий в логическом порядке, активна последняя', () => {
    load();
    render(<Timeline />);
    const chips = screen.getAllByTestId('stage-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['FROM', 'WHERE', 'SELECT', 'ORDER BY', 'LIMIT']);
    expect(chips[4].getAttribute('data-active')).toBe('true');
  });

  it('клик по чипу прыгает к концу стадии мгновенно', () => {
    load();
    render(<Timeline />);
    fireEvent.click(screen.getAllByTestId('stage-chip')[1]);
    const st = useSceneStore.getState();
    expect(st.phaseIndex).toBe(4);
    expect(st.instant).toBe(true);
    expect(screen.getByTestId('timeline-caption').textContent).toBe('WHERE price > 500: осталось 3 из 5');
  });

  it('подпись в aria-live', () => {
    load();
    render(<Timeline />);
    expect(screen.getByTestId('timeline-caption').getAttribute('aria-live')).toBe('polite');
  });

  it('кнопки шагов и плей', () => {
    load();
    render(<Timeline />);
    fireEvent.click(screen.getByTestId('player-prev'));
    expect(useSceneStore.getState().phaseIndex).toBe(9);
    fireEvent.click(screen.getByTestId('player-next'));
    expect(useSceneStore.getState().phaseIndex).toBe(10);
    fireEvent.click(screen.getByTestId('player-toggle'));
    expect(useSceneStore.getState().playing).toBe(true);
  });

  it('скорость, автоплей и камера в меню настроек, состояние видно в пунктах', () => {
    load();
    render(<Timeline />);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Настройки плеера' }), { key: 'Enter' });

    expect(screen.getByRole('menuitemradio', { name: '1x' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '2x' }));
    expect(useSceneStore.getState().speed).toBe(2);
    // меню не закрывается после выбора: видно новое состояние
    expect(screen.getByRole('menuitemradio', { name: '2x' }).getAttribute('aria-checked')).toBe('true');

    const autoplay = screen.getByRole('menuitemcheckbox', { name: 'Автоплей' });
    expect(autoplay.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(autoplay);
    expect(useSceneStore.getState().autoplay).toBe(true);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Автоплей' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    const camera = screen.getByRole('menuitemcheckbox', { name: 'Камера следит' });
    const followed = useSceneStore.getState().followCamera;
    expect(camera.getAttribute('aria-checked')).toBe(String(followed));
    fireEvent.click(camera);
    expect(useSceneStore.getState().followCamera).toBe(!followed);
  });

  it('final-only показывает причину', () => {
    const s = useSceneStore.getState();
    act(() =>
      s.setTrace(
        { ...fullPipelineTrace(), mode: 'final-only', fallbackReason: 'JOIN LATERAL' },
        s.nextGeneration(),
      ),
    );
    render(<Timeline />);
    expect(screen.getByTestId('final-only-note').textContent).toBe('JOIN LATERAL');
    expect(screen.queryAllByTestId('stage-chip')).toHaveLength(0);
  });

  it('ошибка запроса: отсылка к «Сообщениям», а не «не умею»', () => {
    const s = useSceneStore.getState();
    const error = { code: '42703', message: 'column "nope" does not exist' };
    act(() =>
      s.setTrace(
        {
          ...fullPipelineTrace(),
          mode: 'final-only',
          fallbackReason: 'Запрос завершился ошибкой',
          result: null,
          error,
        },
        s.nextGeneration(),
      ),
    );
    render(<Timeline />);
    expect(screen.getByTestId('final-only-note').textContent).toBe(
      'Запрос завершился ошибкой, см. «Сообщения»',
    );
  });

  it('ошибка со сценой (42803): чипы и подпись как у обычной трассы', () => {
    const s = useSceneStore.getState();
    const error = { code: '42803', message: 'column "b.title" must appear in the GROUP BY clause' };
    const trace = { ...fullPipelineTrace(), mode: 'final-only' as const, result: null, error };
    act(() => {
      s.setTrace(trace, s.nextGeneration());
      useSceneStore.getState().setPlayback(buildPlayback(trace, testCtx()));
    });
    render(<Timeline />);
    expect(screen.queryByTestId('final-only-note')).toBeNull();
    expect(screen.getAllByTestId('stage-chip').length).toBeGreaterThan(0);
  });

  it('volatile-стадия помечена значком и подсказкой', () => {
    const trace = fullPipelineTrace();
    trace.stages[2] = { ...trace.stages[2], volatile: true };
    const s = useSceneStore.getState();
    s.setTrace(trace, s.nextGeneration());
    useSceneStore.getState().setPlayback(buildPlayback(trace, testCtx()));
    render(<Timeline />);
    const chip = screen.getAllByTestId('stage-chip')[2];
    expect(chip.textContent).toBe('SELECT ~');
    expect(chip.getAttribute('title')).toContain('volatile');
  });

  it('без трассы таймлайн пустой и не падает', () => {
    render(<Timeline />);
    expect(screen.getByTestId('timeline').textContent).toContain('Напиши запрос');
  });
});
