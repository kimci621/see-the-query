import { create } from 'zustand';
import type { ClauseName } from '@/features/sql/types';

export interface EditorStore {
  text: string;
  cursor: number;
  activeClause: ClauseName | null;
  hoveredColumn: string | null; // 'public.book.title'
  parseError: { message: string; position: number } | null;
  setText(t: string): void;
  setCursor(c: number): void;
  setActiveClause(c: ClauseName | null): void;
  setHoveredColumn(c: string | null): void;
  setParseError(e: EditorStore['parseError']): void;
  insertQuery(sql: string): void; // «На доску»: заменить текст и поставить курсор в конец
}

export const useEditorStore = create<EditorStore>()((set) => ({
  text: '',
  cursor: 0,
  activeClause: null,
  hoveredColumn: null,
  parseError: null,
  setText: (text) => set({ text }),
  setCursor: (cursor) => set({ cursor }),
  setActiveClause: (activeClause) => set({ activeClause }),
  setHoveredColumn: (hoveredColumn) => set({ hoveredColumn }),
  setParseError: (parseError) => set({ parseError }),
  insertQuery: (sql) => set({ text: sql, cursor: sql.length, parseError: null }),
}));
