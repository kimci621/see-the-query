import { create } from 'zustand';
import type { SchemaSnapshot } from '@/features/db/introspect';

export interface BoardStore {
  schema: SchemaSnapshot | null;
  visibleTables: string[] | null;
  focused: string[];
  // Цель рефита камеры: focused или таблицы SELECT-трейса. Рамку не рисует
  frameTarget: string[];
  highlightedColumns: string[];
  // Колонки трейса: по ним сворачиваются широкие таблицы. Наведённой здесь нет: hover не меняет ширину ноды
  queryColumns: string[];
  // Таблицы, развёрнутые звёздочкой запроса (select *, t.*)
  expandedTables: string[];
  dimmed: boolean;
  fitRequest: number;
  focusRequest: number;
  startRequest: number;
  setSchema(s: SchemaSnapshot | null): void;
  setVisibleTables(t: string[] | null): void;
  focus(tableIds: string[]): void;
  retarget(tableIds: string[]): void;
  frameStart(tableIds: string[]): void;
  highlightColumns(cols: string[]): void;
  setQueryColumns(cols: string[]): void;
  expandTables(tableIds: string[]): void;
  setDimmed(v: boolean): void;
  requestFit(): void;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const useBoardStore = create<BoardStore>()((set) => ({
  schema: null,
  visibleTables: null,
  focused: [],
  frameTarget: [],
  highlightedColumns: [],
  queryColumns: [],
  expandedTables: [],
  dimmed: false,
  fitRequest: 0,
  focusRequest: 0,
  startRequest: 0,
  setSchema: (schema) => set({ schema }),
  setVisibleTables: (visibleTables) => set({ visibleTables }),
  // Камера летит только при смене набора: ввод в редакторе вызывает focus на каждый символ
  focus: (tableIds) =>
    set((s) =>
      sameSet(s.focused, tableIds)
        ? sameSet(s.frameTarget, tableIds)
          ? s
          : { frameTarget: tableIds }
        : { focused: tableIds, frameTarget: tableIds, focusRequest: s.focusRequest + 1 },
    ),
  // Цель камеры без полёта и без рамки: SELECT-трейс называет свои таблицы, и рефит при развороте
  // целится в них, а не в прошлый фокус. Рамка остаётся у DML и курсора во FROM (спека 3.4)
  retarget: (tableIds) => set((s) => (sameSet(s.frameTarget, tableIds) ? s : { frameTarget: tableIds })),
  // Стартовый кадр урока (спека 3.4): таблицы стартового запроса. Ставится и при том же наборе,
  // доска наводит камеру без полёта
  frameStart: (tableIds) =>
    set((s) => ({ focused: tableIds, frameTarget: tableIds, startRequest: s.startRequest + 1 })),
  highlightColumns: (cols) =>
    set((s) => (sameList(s.highlightedColumns, cols) ? s : { highlightedColumns: cols })),
  setQueryColumns: (cols) => set((s) => (sameList(s.queryColumns, cols) ? s : { queryColumns: cols })),
  expandTables: (tableIds) =>
    set((s) => (sameSet(s.expandedTables, tableIds) ? s : { expandedTables: tableIds })),
  setDimmed: (dimmed) => set({ dimmed }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
}));
