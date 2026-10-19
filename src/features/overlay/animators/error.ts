import { explainError } from '@/features/errors/explain';
import { currentTable, mapColumns, withTable } from '../frame';
import type { Animator, GhostTable, Phase, StageOf } from '../types';
import { groupAnimator } from './group';

// 42803 «column … must appear»: строки в стопках групп, колонка вне GROUP BY красная.
// Без состава групп: призрак таблицы у её ноды на доске с той же красной колонкой.
// У остальных ошибок (и у 42803 без найденной колонки) сцены нет: всё объясняет панель «Сообщения»
export const errorAnimator: Animator<StageOf<'error'>> = (prev, stage, stageIndex, ctx) => {
  const table = ctx.schema.tables.find((t) => t.id === stage.focus.tableIds[0]);
  const column = stage.error.message.match(/column "(?:[^"]*\.)?([^".]+)" must appear/)?.[1];
  if (stage.error.code !== '42803' || !table || stage.focus.columns.join() !== `${table.id}.${column}`)
    return [];
  const { title } = explainError(stage.error, { sql: '', schema: ctx.schema });
  if (stage.group && currentTable(prev)) return inStacks(prev, stage, stageIndex, ctx, column ?? '', title);
  const rect = ctx.nodeRect(table.id);
  const focus = new Set(stage.focus.columns);
  const ghost: GhostTable = {
    id: `t:${table.name}`,
    title: table.name,
    x: rect?.x ?? ctx.workArea.x,
    y: rect?.y ?? ctx.workArea.y,
    columns: table.columns.map((c) => ({
      name: c.name,
      type: c.type,
      state: focus.has(`${table.id}.${c.name}`) ? 'error' : 'normal',
    })),
    rows: [],
  };
  return [
    {
      id: `${stageIndex}:error`,
      stageIndex,
      caption: `${title}. ${stage.caption}`,
      durationMs: 600,
      frame: { tables: [...prev.tables, ghost], decorations: [] },
    },
  ];
};

// Строки съезжаются в стопки групп, как на стадии GROUP BY, и колонка вне GROUP BY краснеет:
// в одной стопке у неё разные значения, одно на группу не выбрать
function inStacks(
  prev: Parameters<Animator>[0],
  stage: StageOf<'error'>,
  stageIndex: number,
  ctx: Parameters<Animator>[3],
  column: string,
  title: string,
): Phase[] {
  const { keys, groups } = stage.group ?? { keys: [], groups: [] };
  const stacked = groupAnimator(
    prev,
    {
      id: stage.id,
      kind: 'group',
      keys,
      groups,
      aggregates: [],
      caption: '',
      output: { columns: [], rows: [] },
    },
    stageIndex,
    ctx,
  ).filter((p) => !p.id.endsWith(':collapse'));
  const last = stacked[stacked.length - 1];
  const cur = currentTable(last.frame);
  if (!cur) return [];
  // При одноимённых колонках JOIN нужна колонка с алиасом из сообщения
  const qualifier = stage.error.message.match(/column "([^".]+)\.[^"]+" must appear/)?.[1];
  const named = cur.columns.filter((c) => c.name === column);
  const target = named.find((c) => c.source?.alias === qualifier) ?? named[0];
  const keyNames = new Set(keys.map((k) => k.replaceAll('"', '').split('.').at(-1)));
  const marked = mapColumns(cur, (c) => ({
    state: c === target ? 'error' : keyNames.has(c.name) ? 'key' : 'normal',
  }));
  return [
    ...stacked,
    {
      id: `${stageIndex}:error`,
      stageIndex,
      caption: `${title}: в одной группе разные значения ${column}, Postgres не знает, какое показать`,
      durationMs: 900,
      frame: { tables: withTable(last.frame, marked).tables, decorations: last.frame.decorations },
    },
  ];
}
