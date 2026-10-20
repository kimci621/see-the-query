import { describe, expect, it } from 'vitest';
import { runUpTo } from '../__fixtures__/runUpTo';
import { aggregateTrace, groupTrace, joinTrace, testCtx } from '../__fixtures__/traces';
import { currentTable } from '../frame';
import type { StageOf } from '../types';
import { groupAnimator } from './group';

const run = (trace = groupTrace()) => {
  const stage = trace.stages[1] as StageOf<'group'>;
  return { stage, phases: groupAnimator(runUpTo(trace, 1, testCtx()), stage, 1, testCtx()) };
};

describe('groupAnimator', () => {
  const { stage, phases } = run();

  it('три фазы: окраска, стопки, схлопывание', () => {
    expect(phases.map((p) => p.id)).toEqual(['1:color', '1:stack', '1:collapse']);
    expect(phases.every((p) => p.stageIndex === 1)).toBe(true);
  });
  it('строки окрашены в цвет своей группы', () => {
    const byKey = Object.fromEntries(phases[0].frame.tables[0].rows.map((r) => [r.key, r.group]));
    expect(byKey).toEqual({ 'b=(0,1)': 0, 'b=(0,3)': 0, 'b=(0,4)': 1, 'b=(0,10)': 2 });
  });
  it('стопки: члены групп рядом, скобка на каждую группу', () => {
    const rows = phases[1].frame.tables[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['b=(0,1)', 'b=(0,3)', 'b=(0,4)', 'b=(0,10)']);
    const brackets = phases[1].frame.decorations.filter((d) => d.kind === 'bracket');
    expect(brackets).toHaveLength(3);
    expect(brackets[0]).toMatchObject({ table: 't:b', fromRow: 0, toRow: 1, color: 0 });
    expect(brackets[2]).toMatchObject({ fromRow: 3, toRow: 3, color: 2 });
  });
  it('колонки не из GROUP BY и не в агрегате перечёркнуты, ключ подсвечен', () => {
    const cols = Object.fromEntries(phases[1].frame.tables[0].columns.map((c) => [c.name, c.state]));
    expect(cols).toEqual({ book_id: 'removed', title: 'removed', author_id: 'key' });
  });
  it('схлопывание: строки-группы из выхода стадии и счётчик', () => {
    const collapsed = phases[2].frame.tables[0];
    expect(collapsed.id).toBe('t:b');
    expect(collapsed.rows.map((r) => [r.key, r.values, r.group])).toEqual([
      ['g:0', [1, 2], undefined],
      ['g:1', [3, 1], undefined],
      ['g:2', [null, 1], undefined],
    ]);
    expect(phases[2].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '4 → 3' }),
    );
    expect(phases[2].caption).toBe(stage.caption);
  });
  it('колонка внутри агрегата не перечёркнута', () => {
    const { phases: p } = run(groupTrace(['count(*)', 'max(title)'], [1], [1]));
    expect(p[1].frame.tables[0].columns.find((c) => c.name === 'title')?.state).toBe('highlight');
  });
  it('count(col): строки с NULL в колонке получают бейдж', () => {
    const { phases: p } = run(groupTrace(['count(author_id)'], [2], [2]));
    const rows = p[1].frame.tables[0].rows;
    expect(rows.find((r) => r.key === 'b=(0,10)')?.badge).toBe('NULL не считается');
    expect(rows.find((r) => r.key === 'b=(0,1)')?.badge).toBeUndefined();
  });
  it('ключ в кавычках: подпись без кавычек, deparser пишет «"position"», «b."author_id"»', () => {
    for (const key of ['"author_id"', 'b."author_id"']) {
      const trace = groupTrace();
      trace.stages[1] = { ...trace.stages[1], keys: [key] } as StageOf<'group'>;
      expect(run(trace).phases[0].caption, key).toMatch(/^GROUP BY (b\.)?author_id: /);
    }
  });
  it('ключ выражением: колонка под ним подсвечена по номеру, а не перечёркнута', () => {
    const trace = groupTrace();
    trace.stages[1] = { ...trace.stages[1], keys: ['lower(title)'], keyColumns: [1] } as StageOf<'group'>;
    const cols = Object.fromEntries(
      run(trace).phases[1].frame.tables[0].columns.map((c) => [c.name, c.state]),
    );
    expect(cols).toEqual({ book_id: 'removed', title: 'key', author_id: 'removed' });
  });
  it('квалифицированный ключ на JOIN: a.author_id подсвечивает только колонку author, не b.author_id', () => {
    const trace = joinTrace('left');
    const rows = trace.stages[2].output.rows;
    const keyed = {
      id: 's3',
      kind: 'group',
      keys: ['a.author_id'],
      keyColumns: [3],
      aggregates: ['count(*)'],
      aggregateColumns: [],
      nullSkipColumns: [],
      groups: [{ key: 'g:0', members: rows.map((r) => r.key) }],
      caption: 'GROUP BY a.author_id',
      output: { columns: [], rows: [] },
    } as StageOf<'group'>;
    const p = groupAnimator(runUpTo(trace, 3, testCtx()), keyed, 3, testCtx());
    const cols = currentTable(p[1].frame)?.columns ?? [];
    expect(cols.filter((c) => c.state === 'key').map((c) => `${c.source?.alias}.${c.name}`)).toEqual([
      'a.author_id',
    ]);
  });
  it('сжатый режим: только схлопывание', () => {
    const trace = groupTrace();
    trace.stages[1] = { ...trace.stages[1], compressed: true, rowCount: 3 } as StageOf<'group'>;
    expect(run(trace).phases.map((p) => p.id)).toEqual(['1:collapse']);
  });
  it('свёрнутый вход: номера колонок трассировщика ложатся на показанные колонки, а не на позиции', () => {
    // title спрятан, как на ноде: в призраке book_id и author_id, а ключ и count(author_id) это колонка 2 входа
    const ctx = { ...testCtx(), folded: () => ['title'] };
    const trace = groupTrace(['count(author_id)'], [2], [2]);
    const p = groupAnimator(runUpTo(trace, 1, ctx), trace.stages[1] as StageOf<'group'>, 1, ctx);
    const t = p[1].frame.tables[0];
    expect(t.columns.map((c) => [c.name, c.state])).toEqual([
      ['book_id', 'removed'],
      ['author_id', 'key'],
    ]);
    expect(t.rows.find((r) => r.key === 'b=(0,10)')?.badge).toBe('NULL не считается');
  });
});

describe('groupAnimator: агрегат без GROUP BY', () => {
  const { stage, phases } = run(aggregateTrace());

  it('одна скобка на все строки, итог одна строка, счётчик 4 → 1', () => {
    expect(phases[1].frame.decorations.filter((d) => d.kind === 'bracket')).toEqual([
      expect.objectContaining({ fromRow: 0, toRow: 3 }),
    ]);
    expect(phases[2].frame.tables[0].rows.map((r) => [r.key, r.values])).toEqual([['g:0', [4]]]);
    expect(phases[2].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: '4 → 1' }),
    );
  });
  it('подписи окраски и стопки про одну стопку, а не про группы', () => {
    expect(phases.slice(0, 2).map((p) => p.caption)).toEqual([
      'Агрегат без GROUP BY: одна группа на все строки',
      'Агрегат без GROUP BY: строки собираются в одну стопку',
    ]);
  });
  it('итоговое значение агрегата в подписи', () => {
    expect(phases[2].caption).toBe(`${stage.caption}: count(*) = 4`);
  });
  it('пустой вход: скобок нет, одна строка', () => {
    const trace = aggregateTrace();
    const empty = {
      ...trace.stages[1],
      groups: [{ key: 'g:0', members: [] }],
      output: { ...trace.stages[1].output, rows: [{ key: 'g:0', lineage: {}, values: [0] }] },
    } as StageOf<'group'>;
    const before = { ...runUpTo(trace, 1, testCtx()) };
    before.tables = before.tables.map((t) => ({ ...t, rows: [] }));
    const p = groupAnimator(before, empty, 1, testCtx());
    expect(p[1].frame.decorations.filter((d) => d.kind === 'bracket')).toEqual([]);
    expect(p[2].frame.tables[0].rows).toHaveLength(1);
    expect(p[2].frame.decorations).toContainEqual(expect.objectContaining({ text: '0 → 1' }));
    expect(p.slice(0, 2).map((x) => x.caption)).toEqual([
      'Агрегат без GROUP BY: строк нет',
      'Агрегат без GROUP BY: стопка пустая, итог всё равно одна строка',
    ]);
  });
  it('пустой вход: sum без строк в подписи NULL, как на доске', () => {
    const trace = aggregateTrace();
    const empty = {
      ...trace.stages[1],
      aggregates: ['sum(price)', 'count(price)'],
      groups: [{ key: 'g:0', members: [] }],
      output: { ...trace.stages[1].output, rows: [{ key: 'g:0', lineage: {}, values: [null, 0] }] },
    } as StageOf<'group'>;
    const p = groupAnimator(runUpTo(trace, 1, testCtx()), empty, 1, testCtx());
    expect(p.at(-1)?.caption).toBe(`${empty.caption}: sum(price) = NULL, count(price) = 0`);
  });
});

describe('groupAnimator: агрегат набегает по строкам', () => {
  const trace = aggregateTrace();
  const stage = {
    ...trace.stages[1],
    aggregates: ['count(*)', 'count(author_id)'],
    aggregateColumns: [2],
    nullSkipColumns: [2],
    running: [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 3],
    ],
    output: { ...trace.stages[1].output, rows: [{ key: 'g:0', lineage: {}, values: [4, 3] }] },
  } as StageOf<'group'>;
  const phases = groupAnimator(runUpTo(trace, 1, testCtx()), stage, 1, testCtx());
  const states = (i: number) => phases[i].frame.tables[0].rows.map((r) => r.state);

  it('между стопкой и схлопыванием фаза на каждую строку', () => {
    expect(phases.map((p) => p.id)).toEqual([
      '1:color',
      '1:stack',
      '1:tick:0',
      '1:tick:1',
      '1:tick:2',
      '1:tick:3',
      '1:collapse',
    ]);
  });
  it('подпись и счётчик показывают значение после строки', () => {
    expect(phases[3].caption).toBe('Агрегат без GROUP BY: count(*) = 2, count(author_id) = 2');
    expect(phases[5].frame.decorations).toContainEqual(
      expect.objectContaining({ kind: 'counter', text: 'count(*) = 4, count(author_id) = 3' }),
    );
  });
  it('текущая строка подсвечена, NULL в count(col) серый и не засчитан', () => {
    expect(states(3)).toEqual(['kept', 'matched', 'normal', 'normal']);
    expect(states(5)).toEqual(['kept', 'kept', 'kept', 'unknown']);
  });
});
