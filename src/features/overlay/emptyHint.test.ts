import { describe, expect, it } from 'vitest';
import type { Trace } from '@/features/tracer/types';
import { compressedTrace, fullPipelineTrace } from './__fixtures__/traces';
import { emptyResultHint } from './emptyHint';

const emptyResult = { fields: [], rows: [] };

function whereKillsAll(): Trace {
  const t = fullPipelineTrace();
  const stages = t.stages
    .slice(0, 2)
    .map((s, i) => (i === 1 ? { ...s, output: { ...s.output, rows: [] } } : s));
  return { ...t, stages, result: emptyResult };
}

describe('emptyResultHint', () => {
  it('называет стадию, где пропали строки', () => {
    expect(emptyResultHint(whereKillsAll())).toBe('Строки пропали на шаге WHERE: было 5, стало 0.');
  });

  it('пустая таблица с самого начала', () => {
    const t = fullPipelineTrace();
    const scan = { ...t.stages[0], output: { ...t.stages[0].output, rows: [] } };
    expect(emptyResultHint({ ...t, stages: [scan], result: emptyResult })).toBe(
      'В таблице book b нет строк: пусто с самого начала.',
    );
  });

  it('сжатый режим Ф5: числа из rowCount, а не из пустых rows', () => {
    const t = compressedTrace(5000);
    const filter = { ...t.stages[1], rowCount: 0 };
    expect(emptyResultHint({ ...t, stages: [t.stages[0], filter], result: emptyResult })).toBe(
      'Строки пропали на шаге WHERE: было 5000, стало 0.',
    );
  });

  it('непустой результат и final-only без подсказки', () => {
    expect(emptyResultHint({ ...fullPipelineTrace(), result: { fields: [], rows: [[1]] } })).toBeNull();
    expect(emptyResultHint({ ...whereKillsAll(), mode: 'final-only' })).toBeNull();
  });
});
