import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace } from '@/features/overlay/__fixtures__/traces';
import { Timeline } from '@/features/timeline/Timeline';
import { useSceneStore } from '@/stores/scene';
import { useSettingsStore } from '@/stores/settings';
import { ResultsPanel } from './ResultsPanel';

describe('ResultsPanel', () => {
  beforeEach(() => {
    useSceneStore.setState(useSceneStore.getInitialState(), true);
    useSettingsStore.setState({ locale: 'ru' });
  });

  it('показывает вкладки и пустой результат на английском', () => {
    useSettingsStore.setState({ locale: 'en' });
    const trace = fullPipelineTrace();
    const stages = trace.stages
      .slice(0, 2)
      .map((s, i) => (i === 1 ? { ...s, output: { ...s.output, rows: [] } } : s));
    const result = { fields: [], rows: [], command: 'SELECT', rowCount: 0 };
    useSceneStore
      .getState()
      .setTrace({ ...trace, stages, result }, useSceneStore.getState().nextGeneration());
    render(<ResultsPanel />);
    expect(screen.getByRole('tab', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.getByText('0 rows. Rows disappeared at WHERE: 5 before, 0 after.')).toBeInTheDocument();
    useSettingsStore.setState({ locale: 'ru' });
  });

  it('показывает статистику плана на английском', async () => {
    useSettingsStore.setState({ locale: 'en' });
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
    render(<ResultsPanel />);
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByText(/read ≈10 rows/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seq Scan on public.book/ })).toBeInTheDocument();
    useSettingsStore.setState({ locale: 'ru' });
  });

  it('использует единственное число для одной строки плана на английском', async () => {
    useSettingsStore.setState({ locale: 'en' });
    const trace = fullPipelineTrace();
    const plan = { nodeType: 'Seq Scan', actualRows: 1, rowsRemoved: 0, loops: 1, planRows: 1, children: [] };
    useSceneStore.getState().setTrace({ ...trace, plan }, useSceneStore.getState().nextGeneration());
    render(<ResultsPanel />);
    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(screen.getByText('read 1 row · returned 1 row · estimated 1 row per loop')).toBeInTheDocument();
  });

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
