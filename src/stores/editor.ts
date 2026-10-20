import { create } from 'zustand';
import type { ClauseName } from '@/features/sql/types';
import type { Trace } from '@/features/tracer/types';

export interface EditorStore {
  text: string;
  cursor: number;
  activeClause: ClauseName | null;
  hoveredColumn: string | null; // 'public.book.title'
  parseError: { message: string; position: number } | null;
  // Итоги «Применить» по номеру оператора в тексте. Пока текст не правили, превью этих операторов
  // не выполняется, а повторное «Применить» ничего не делает (спека 3.9). Любая правка текста сбрасывает
  applied: Record<number, Trace>;
  setText(t: string): void;
  setCursor(c: number): void;
  setActiveClause(c: ClauseName | null): void;
  setHoveredColumn(c: string | null): void;
  setParseError(e: EditorStore['parseError']): void;
  insertQuery(sql: string): void; // «На доску»: заменить текст и поставить курсор в конец
  markApplied(index: number, trace: Trace): void;
  clearApplied(): void;
}

export const useEditorStore = create<EditorStore>()((set) => ({
  text: '',
  cursor: 0,
  activeClause: null,
  hoveredColumn: null,
  parseError: null,
  applied: {},
  setText: (text) => set((s) => (s.text === text ? s : { text, applied: {} })),
  setCursor: (cursor) => set({ cursor }),
  setActiveClause: (activeClause) => set({ activeClause }),
  setHoveredColumn: (hoveredColumn) => set({ hoveredColumn }),
  setParseError: (parseError) => set({ parseError }),
  insertQuery: (sql) => set({ text: sql, cursor: sql.length, parseError: null, applied: {} }),
  markApplied: (index, trace) => set((s) => ({ applied: { ...s.applied, [index]: trace } })),
  clearApplied: () => set((s) => (Object.keys(s.applied).length ? { applied: {} } : s)),
}));
