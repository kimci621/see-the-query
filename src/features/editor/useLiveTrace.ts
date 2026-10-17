import { useEffect, useMemo, useState } from 'react';
import type { Sandbox } from '@/features/db/sandbox';
import type { DbError } from '@/features/db/types';
import { DbException } from '@/features/db/types';
import { parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { touchedOf } from './touched';
import { useParserReady } from './useParsedText';

const DEBOUNCE_MS = 250;

// Живое превью (спека 5.3, без трассировщика до Ф5): парсим текст, берём оператор под
// курсором, выполняем его в транзакции песочницы и кладём Trace «только итог».
// Поколения защищают от гонки: setTrace отбрасывает ответ устаревшего запроса.
export function useLiveTrace(sandbox: Sandbox | null): void {
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const schema = useBoardStore((s) => s.schema);
  const parserReady = useParserReady();
  const [dataVersion, setDataVersion] = useState(0);

  // После apply/undo/reset/loadLesson песочница шлёт changed: данные изменились, превью перевыполняем
  useEffect(() => {
    if (!sandbox) return;
    return sandbox.subscribe((e) => {
      if (e.type === 'changed') setDataVersion((v) => v + 1);
    });
  }, [sandbox]);

  const stmtIndex = useMemo(() => {
    if (!parserReady || text.trim() === '') return -1;
    const parsed = parseSql(text);
    return parsed.ok ? (statementAt(parsed.statements, cursor)?.index ?? -1) : -1;
  }, [parserReady, text, cursor]);

  // Курсор читаем внутри таймера, а не замыкаем: иначе эффект пришлось бы перезапускать
  // на каждое движение курсора. dataVersion обновляет превью при изменении данных,
  // stmtIndex - при переводе курсора в другой оператор.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataVersion updates on data change, stmtIndex on statement switch
  useEffect(() => {
    if (!sandbox || !parserReady) return;
    const generation = useSceneStore.getState().nextGeneration();
    const timer = setTimeout(() => {
      const cursor = useEditorStore.getState().cursor;
      void runPreview(text, cursor, generation, sandbox, schema);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sandbox, parserReady, text, stmtIndex, dataVersion, schema]);
}

async function runPreview(
  text: string,
  cursor: number,
  generation: number,
  sandbox: Sandbox,
  schema: ReturnType<typeof useBoardStore.getState>['schema'],
): Promise<void> {
  const editor = useEditorStore.getState();
  const scene = useSceneStore.getState();
  const parsed = parseSql(text);
  if (!parsed.ok) {
    // недописанный запрос: подчёркиваем, последняя валидная сцена остаётся и гаснет, без мигания
    editor.setParseError(parsed.error);
    scene.setStale(true);
    return;
  }
  editor.setParseError(null);
  const stmt = statementAt(parsed.statements, cursor);
  if (!stmt) {
    scene.close();
    return;
  }
  const started = performance.now();
  const base = {
    sql: stmt.text,
    statementType: stmt.kind,
    mode: 'final-only' as const,
    fallbackReason: 'Пошаговый разбор запроса появится позже', // Ф5 подменит на traceStatement
    touched: touchedOf(stmt, schema),
    stages: [],
    notices: [],
  };
  try {
    const result = await sandbox.preview((db) => db.query(stmt.text));
    useSceneStore.getState().setTrace(
      {
        ...base,
        result,
        error: null,
        timingMs: Math.round(performance.now() - started),
      },
      generation,
    );
  } catch (e) {
    const error: DbError = e instanceof DbException ? e.db : { code: 'VS000', message: String(e) };
    useSceneStore.getState().setTrace(
      {
        ...base,
        result: null,
        error,
        timingMs: Math.round(performance.now() - started),
      },
      generation,
    );
  }
}
