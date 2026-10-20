import { create } from 'zustand';
import type { SchemaSnapshot } from '@/features/db/introspect';

// Запись «Применить» (спека 3.9): строки с xmin >= since записал этот оператор, mark - как их пометить
export interface AppliedWrite {
  since: number;
  mark: 'new' | 'changed';
}

export interface BoardStore {
  schema: SchemaSnapshot | null;
  visibleTables: string[] | null;
  // Таблицы, которых нет в датасете (создал ученик): доска урока показывает их вместе с board.tables
  userTables: string[];
  focused: string[];
  highlightedColumns: string[];
  // Колонки трейса: по ним сворачиваются широкие таблицы. Наведённой здесь нет: hover не меняет ширину ноды
  queryColumns: string[];
  // Таблицы, развёрнутые звёздочкой запроса (select *, t.*)
  expandedTables: string[];
  dimmed: boolean;
  // Пометки строк после «Применить»: ставятся вместе со схемой, снимаются следующим запросом
  rowWrites: AppliedWrite[];
  fitRequest: number;
  // Камера к focused (без него вся доска) без проверки набора: сцена ушла, а камера стоит на призраке
  frameRequest: number;
  focusRequest: number;
  startRequest: number;
  setSchema(s: SchemaSnapshot | null, userTables?: string[], rowWrites?: AppliedWrite[]): void;
  clearRowWrites(): void;
  setVisibleTables(t: string[] | null): void;
  focus(tableIds: string[]): void;
  frameStart(tableIds: string[]): void;
  highlightColumns(cols: string[]): void;
  setQueryColumns(cols: string[]): void;
  expandTables(tableIds: string[]): void;
  setDimmed(v: boolean): void;
  requestFit(): void;
  requestFrame(): void;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const useBoardStore = create<BoardStore>()((set) => ({
  schema: null,
  visibleTables: null,
  userTables: [],
  focused: [],
  highlightedColumns: [],
  queryColumns: [],
  expandedTables: [],
  dimmed: false,
  rowWrites: [],
  fitRequest: 0,
  frameRequest: 0,
  focusRequest: 0,
  startRequest: 0,
  // Одно обновление: новые данные и их пометки появляются на доске вместе, без анимации
  setSchema: (schema, userTables = [], rowWrites = []) =>
    set((s) => ({
      schema,
      userTables: sameList(s.userTables, userTables) ? s.userTables : userTables,
      rowWrites: rowWrites.length === 0 && s.rowWrites.length === 0 ? s.rowWrites : rowWrites,
    })),
  clearRowWrites: () => set((s) => (s.rowWrites.length === 0 ? s : { rowWrites: [] })),
  setVisibleTables: (visibleTables) => set({ visibleTables }),
  // Камера летит только при смене набора: ввод в редакторе вызывает focus на каждый символ
  focus: (tableIds) =>
    set((s) => (sameSet(s.focused, tableIds) ? s : { focused: tableIds, focusRequest: s.focusRequest + 1 })),
  // Стартовый кадр урока (спека 3.4): таблицы стартового запроса. Ставится и при том же наборе,
  // доска наводит камеру без полёта
  frameStart: (tableIds) => set((s) => ({ focused: tableIds, startRequest: s.startRequest + 1 })),
  highlightColumns: (cols) =>
    set((s) => (sameList(s.highlightedColumns, cols) ? s : { highlightedColumns: cols })),
  setQueryColumns: (cols) => set((s) => (sameList(s.queryColumns, cols) ? s : { queryColumns: cols })),
  expandTables: (tableIds) =>
    set((s) => (sameSet(s.expandedTables, tableIds) ? s : { expandedTables: tableIds })),
  setDimmed: (dimmed) => set({ dimmed }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  requestFrame: () => set((s) => ({ frameRequest: s.frameRequest + 1 })),
}));
