import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fullPipelineTrace } from '@/features/overlay/__fixtures__/traces';
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
});
