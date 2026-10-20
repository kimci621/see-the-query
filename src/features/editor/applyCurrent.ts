import type { Sandbox } from '@/features/db/sandbox';
import { initParser, isParserReady, parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import type { ParsedStatement } from '@/features/sql/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { notifyApplied, notifyDbError } from './notifyDbError';
import { alteredTableOf, dmlTargetOf } from './touched';
import { appliedTrace } from './useLiveTrace';

// Фокус на целевую таблицу DML-оператора из текста; для остальных операторов ничего не делает.
// fly: камера летит к таблице, даже если фокус уже на ней (после «Применить» камера могла остаться на призраке сцены)
export function focusDmlTarget(sql: string, fly = false): void {
  const parsed = parseSql(sql);
  const stmt = parsed.ok ? parsed.statements[0] : undefined;
  const target = stmt && dmlTargetOf(stmt, useBoardStore.getState().schema);
  if (!target) return;
  useBoardStore.getState().focus([target]);
  if (fly) useBoardStore.getState().requestFrame();
}

// «Применить» DDL (спека 3.4): новой таблицы на доске ещё нет, камера ждёт схему после записи.
// Появилась таблица (CREATE, RENAME TO) - летим к ней, ALTER - к изменённой, исчезла (DROP) - вся доска
function frameAfterDdl(stmt: ParsedStatement): void {
  const before = useBoardStore.getState().schema;
  const unsubscribe = useBoardStore.subscribe(({ schema }) => {
    if (schema === before) return;
    unsubscribe();
    // схема сброшена: урок пересобирается, кадр поставит старт урока
    if (!schema || !before) return;
    const board = useBoardStore.getState();
    const had = new Set(before.tables.map((t) => t.id));
    const added = schema.tables.filter((t) => !had.has(t.id)).map((t) => t.id);
    const altered = alteredTableOf(stmt, schema);
    const target = added.length > 0 ? added : altered ? [altered] : null;
    if (target) {
      board.focus(target);
      board.requestFrame();
    } else if (schema.tables.length < had.size) {
      board.focus([]);
      board.requestFit();
    }
  });
}

// Применение в пути: второй вызов до ответа базы получает тот же промис и ничего не пишет
let inFlight: Promise<void> | null = null;

// Единый путь «Применить» для кнопки тулбара, ⌘⏎ и кнопки примера урока: применяет оператор под курсором
export function applyCurrent(sandbox: Sandbox): Promise<void> {
  inFlight ??= applyStatement(sandbox).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function applyStatement(sandbox: Sandbox): Promise<void> {
  if (!isParserReady()) await initParser();
  const editor = useEditorStore.getState();
  const parsed = parseSql(editor.text);
  if (!parsed.ok) return;
  const stmt = statementAt(parsed.statements, editor.cursor);
  // «Применено»: повтор ничего не пишет, пока текст не изменён (спека 3.9)
  if (!stmt || editor.applied[stmt.index]) return;
  const started = performance.now();
  try {
    const results = await sandbox.apply(stmt.text);
    // SELECT базу не меняет: его сцена превью остаётся. Текст правили во время применения - номер уже чужой
    if (stmt.kind !== 'select' && useEditorStore.getState().text === editor.text) {
      const trace = appliedTrace(stmt, results, Math.round(performance.now() - started));
      useEditorStore.getState().markApplied(stmt.index, trace);
      useSceneStore.getState().setTrace(trace, useSceneStore.getState().nextGeneration());
    }
    notifyApplied(results);
    if (stmt.kind === 'ddl') frameAfterDdl(stmt);
    else focusDmlTarget(stmt.text, true);
  } catch (e) {
    notifyDbError(e, stmt.text);
  }
}
