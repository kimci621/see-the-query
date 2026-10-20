import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LessonProgress {
  visited: boolean;
  completed: boolean;
  lastQuery?: string;
  journal: string[];
  viewport?: { x: number; y: number; zoom: number };
  ranExample: boolean;
  // Метка конца урока была на экране. Хранится, а не живёт в эффекте урока: режим фокуса и перезагрузка
  // размонтируют теорию, и дочитанный урок не стал бы «пройден» после запуска примера. Старые записи без поля
  readToEnd?: boolean;
}

export interface LessonStore {
  byId: Record<string, LessonProgress>;
  markVisited(id: string): void;
  markRanExample(id: string): void;
  markReadToEnd(id: string): void;
  setLastQuery(id: string, q: string | undefined): void;
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
    (set, get) => {
      // Обновляет одну запись, создавая её при первом обращении.
      // Пройден (спека 3.1): дочитал до конца и запустил пример, в любом порядке и в любой заход
      const patch = (id: string, change: Partial<LessonProgress>) =>
        set((s) => {
          const next = { ...(s.byId[id] ?? emptyProgress()), ...change };
          if (next.readToEnd && next.ranExample) next.completed = true;
          return { byId: { ...s.byId, [id]: next } };
        });
      return {
        byId: {},
        markVisited: (id) => patch(id, { visited: true }),
        markRanExample: (id) => patch(id, { ranExample: true }),
        // метка конца показывается при каждой прокрутке к ней: пишем один раз
        markReadToEnd: (id) => {
          if (!get().byId[id]?.readToEnd) patch(id, { readToEnd: true });
        },
        setLastQuery: (id, lastQuery) => patch(id, { lastQuery }),
        setJournal: (id, journal) => patch(id, { journal }),
        setViewport: (id, viewport) => patch(id, { viewport }),
      };
    },
    { name: 'vs-lessons', version: 1, partialize: (s) => ({ byId: s.byId }) },
  ),
);
