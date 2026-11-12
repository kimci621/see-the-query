import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace } from '@/features/overlay/__fixtures__/traces';
import { Timeline } from '@/features/timeline/Timeline';
import { useSceneStore } from '@/stores/scene';
import { ResultsPanel } from './ResultsPanel';

describe('ResultsPanel', () => {
  beforeEach(() => useSceneStore.setState(useSceneStore.getInitialState(), true));

  it('пустой результат: «0 строк» и шаг, где пропали строки', () => {
    const t = fullPipelineTrace();
    const stages = t.stages
      .slice(0, 2)
      .map((s, i) => (i === 1 ? { ...s, output: { ...s.output, rows: [] } } : s));
    const result = { fields: [], rows: [], command: 'SELECT', rowCount: 0 };
    useSceneStore.getState().setTrace({ ...t, stages, result }, useSceneStore.getState().nextGeneration());
    render(<ResultsPanel />);
    expect(screen.getByText('0 строк. Строки пропали на шаге WHERE: было 5, стало 0.')).toBeTruthy();
  });
  it('план подсвечивает связанный шаг при фокусе и убирает подсветку при закрытии вкладки', async () => {
    const trace = fullPipelineTrace();
    const plan = {
      nodeType: 'Seq Scan',
      relation: 'book',
      schema: 'public',
      alias: 'b',
      actualRows: 3,
      rowsRemoved: 2,
      loops: 2,
      children: [],
    };
    useSceneStore.getState().setTrace({ ...trace, plan }, useSceneStore.getState().nextGeneration());
    render(
      <>
        <ResultsPanel />
        <Timeline />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'План' }));
    expect(screen.getByText(/прочитано ≈10 строк/)).toBeInTheDocument();
    const node = screen.getByRole('button', { name: /Seq Scan по public.book/ });
    fireEvent.focus(node);
    expect(useSceneStore.getState().hoveredStage).toBe(0);
    expect(screen.getAllByTestId('stage-chip')[0]).toHaveAttribute('data-plan-hover', 'true');
    await user.click(screen.getByRole('tab', { name: 'Результат' }));
    expect(useSceneStore.getState().hoveredStage).toBeNull();
    act(() => useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration()));
    expect(screen.queryByRole('tab', { name: 'План' })).toBeNull();
  });
});
