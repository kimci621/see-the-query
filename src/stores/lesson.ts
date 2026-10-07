import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LessonProgress {
  visited: boolean;
  completed: boolean;
  lastQuery?: string;
  journal: string[];
  viewport?: { x: number; y: number; zoom: number };
  ranExample: boolean;
}

export interface LessonStore {
  byId: Record<string, LessonProgress>;
  markVisited(id: string): void;
  markRanExample(id: string): void;
  markCompleted(id: string): void;
  setLastQuery(id: string, q: string): void;
  setJournal(id: string, j: string[]): void;
  setViewport(id: string, v: LessonProgress['viewport']): void;
}

const emptyProgress = (): LessonProgress => ({
  visited: false,
  completed: false,
  journal: [],
  ranExample: false,
});

export function lessonStatus(p: LessonProgress | undefined): 'new' | 'visited' | 'completed' {
  if (!p) return 'new';
  if (p.completed) return 'completed';
  return p.visited ? 'visited' : 'new';
}

export const useLessonStore = create<LessonStore>()(
  persist(
    (set) => {
      // Обновляет одну запись, создавая её при первом обращении
      const patch = (id: string, change: Partial<LessonProgress>) =>
        set((s) => ({ byId: { ...s.byId, [id]: { ...(s.byId[id] ?? emptyProgress()), ...change } } }));
      return {
        byId: {},
        markVisited: (id) => patch(id, { visited: true }),
        markRanExample: (id) => patch(id, { ranExample: true }),
        markCompleted: (id) => patch(id, { completed: true }),
        setLastQuery: (id, lastQuery) => patch(id, { lastQuery }),
        setJournal: (id, journal) => patch(id, { journal }),
        setViewport: (id, viewport) => patch(id, { viewport }),
      };
    },
    { name: 'vs-lessons', version: 1, partialize: (s) => ({ byId: s.byId }) },
  ),
);
