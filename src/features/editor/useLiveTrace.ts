import { useEffect, useMemo, useState } from 'react';
import type { Sandbox } from '@/features/db/sandbox';
import type { DbError, QueryResult } from '@/features/db/types';
import { DbException } from '@/features/db/types';
import { parseSql } from '@/features/sql/parser';
import { statementAt } from '@/features/sql/statements';
import type { ParsedStatement } from '@/features/sql/types';
import { traceStatement } from '@/features/tracer/trace';
import type { Trace } from '@/features/tracer/types';
import { useBoardStore } from '@/stores/board';
import { useEditorStore } from '@/stores/editor';
import { useSceneStore } from '@/stores/scene';
import { touchedOf } from './touched';
import { useParserReady } from './useParsedText';

const DEBOUNCE_MS = 250;

// Живое превью (спека 5.3): парсим текст, берём оператор под курсором, трассируем его
// в транзакции песочницы. Нет схемы или трассировщик сломался → Trace «только итог».
// Поколения защищают от гонки: setTrace отбрасывает ответ устаревшего запроса.
export function useLiveTrace(sandbox: Sandbox | null): void {
  const text = useEditorStore((s) => s.text);
  const cursor = useEditorStore((s) => s.cursor);
  const schema = useBoardStore((s) => s.schema);
  const parserReady = useParserReady();
  const [dataVersion, setDataVersion] = useState(0);

  // После apply/undo/reset/loadLesson песочница шлёт changed: данные изменились, превью перевыполняем.
  // Отмена, сброс и новый урок снимают «Применено»: операторы текста больше не применены
  useEffect(() => {
    if (!sandbox) return;
    return sandbox.subscribe((e) => {
      if (e.type !== 'changed') return;
      if (!e.apply) useEditorStore.getState().clearApplied();
      setDataVersion((v) => v + 1);
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

// Трасса без шагов: подсветка из редактора, итог задаёт вызывающий
function baseTrace(stmt: ParsedStatement, schema: ReturnType<typeof useBoardStore.getState>['schema']) {
  return {
    sql: stmt.text,
    statementType: stmt.kind,
    mode: 'final-only' as const,
    fallbackReason: 'Пошаговый разбор недоступен',
    touched: touchedOf(stmt, schema),
    stages: [],
    notices: [],
  };
}

// Итог «Применить» для панели результата: последний результат оператора, без сцены (спека 3.9)
export function appliedTrace(stmt: ParsedStatement, results: QueryResult[], timingMs: number): Trace {
  return {
    ...baseTrace(stmt, useBoardStore.getState().schema),
    fallbackReason: 'Запрос применён. Измени текст, и превью вернётся',
    result: results.at(-1) ?? null,
    error: null,
    timingMs,
  };
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
  // Применённый оператор повторно не выполняем: CREATE дал бы «уже есть», INSERT показал бы следующий id
  const applied = editor.applied[stmt.index];
  if (applied) {
    scene.setTrace(applied, generation);
    return;
  }
  const started = performance.now();
  const base = baseTrace(stmt, schema);
  try {
    const traced = schema
      ? await sandbox.preview(async (db): Promise<Trace | null> => {
          try {
            return await traceStatement(stmt, db, { schema });
          } catch (e) {
            // Ошибку базы показываем как есть, баг трассировщика не должен прятать итог
            if (e instanceof DbException) throw e;
            if (import.meta.env.DEV) console.error('[tracer]', e);
            return null;
          }
        })
      : null;
    // Итог без трассы: отдельное превью, в транзакции трассировщика оператор уже выполнялся
    const out = traced ?? (await sandbox.preview((db) => db.query(stmt.text)));
    // Подсветку колонок по-прежнему считает редактор
    if ('stages' in out) {
      useSceneStore.getState().setTrace({ ...out, touched: base.touched }, generation);
      return;
    }
    const result = out;
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
