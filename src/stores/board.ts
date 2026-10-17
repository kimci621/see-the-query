import { create } from 'zustand';
import type { SchemaSnapshot } from '@/features/db/introspect';

export interface BoardStore {
  schema: SchemaSnapshot | null;
  visibleTables: string[] | null;
  focused: string[];
  highlightedColumns: string[];
  // Таблицы, развёрнутые звёздочкой запроса (select *, t.*)
  expandedTables: string[];
  dimmed: boolean;
  fitRequest: number;
  focusRequest: number;
  setSchema(s: SchemaSnapshot): void;
  setVisibleTables(t: string[] | null): void;
  focus(tableIds: string[]): void;
  highlightColumns(cols: string[]): void;
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
  highlightedColumns: [],
  expandedTables: [],
  dimmed: false,
  fitRequest: 0,
  focusRequest: 0,
  setSchema: (schema) => set({ schema }),
  setVisibleTables: (visibleTables) => set({ visibleTables }),
  // Камера летит только при смене набора: ввод в редакторе вызывает focus на каждый символ
  focus: (tableIds) =>
    set((s) => (sameSet(s.focused, tableIds) ? s : { focused: tableIds, focusRequest: s.focusRequest + 1 })),
  highlightColumns: (cols) =>
    set((s) => (sameList(s.highlightedColumns, cols) ? s : { highlightedColumns: cols })),
  expandTables: (tableIds) =>
    set((s) => (sameSet(s.expandedTables, tableIds) ? s : { expandedTables: tableIds })),
  setDimmed: (dimmed) => set({ dimmed }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
}));
