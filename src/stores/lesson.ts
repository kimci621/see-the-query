import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SequenceCheckpoint } from '@/features/db/sandbox';
import type { Locale } from '@/lib/i18n';

export interface LessonWorkspace {
  lastQuery?: string;
  journal: string[];
  sequenceCheckpoints?: SequenceCheckpoint[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface LessonProgress {
  visited: boolean;
  completed: boolean;
  workspaces: Partial<Record<Locale, LessonWorkspace>>;
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
  setLastQuery(id: string, q: string | undefined, locale?: Locale): void;
  setJournal(id: string, j: string[], locale?: Locale, checkpoints?: SequenceCheckpoint[]): void;
  setViewport(id: string, v: LessonWorkspace['viewport'], locale?: Locale): void;
}

const emptyProgress = (): LessonProgress => ({
  visited: false,
  completed: false,
  workspaces: {},
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
      const patchWorkspace = (id: string, locale: Locale, change: Partial<LessonWorkspace>) =>
        set((s) => {
          const current = s.byId[id] ?? emptyProgress();
          const workspace = { journal: [], ...current.workspaces[locale], ...change };
          return {
            byId: {
              ...s.byId,
              [id]: { ...current, workspaces: { ...current.workspaces, [locale]: workspace } },
            },
          };
        });
      return {
        byId: {},
        markVisited: (id) => patch(id, { visited: true }),
        markRanExample: (id) => patch(id, { ranExample: true }),
        // метка конца показывается при каждой прокрутке к ней: пишем один раз
        markReadToEnd: (id) => {
          if (!get().byId[id]?.readToEnd) patch(id, { readToEnd: true });
        },
        setLastQuery: (id, lastQuery, locale = 'ru') => patchWorkspace(id, locale, { lastQuery }),
        setJournal: (id, journal, locale = 'ru', sequenceCheckpoints) =>
          patchWorkspace(id, locale, {
            journal,
            ...(sequenceCheckpoints === undefined ? {} : { sequenceCheckpoints }),
          }),
        setViewport: (id, viewport, locale = 'ru') => patchWorkspace(id, locale, { viewport }),
      };
    },
    {
      name: 'vs-lessons',
      version: 2,
      partialize: (s) => ({ byId: s.byId }),
      migrate: (persisted, version) => {
        if (version > 2) throw new Error('Сохранения созданы более новой версией приложения');
        const state = persisted as { byId: Record<string, LessonProgress & Partial<LessonWorkspace>> };
        const byId = Object.fromEntries(
          Object.entries(state.byId ?? {}).map(([id, progress]) => {
            const { journal = [], lastQuery, viewport, workspaces, ...shared } = progress;
            const ru = {
              journal,
              ...(lastQuery === undefined ? {} : { lastQuery }),
              ...(viewport === undefined ? {} : { viewport }),
              ...workspaces?.ru,
            };
            return [id, { ...shared, workspaces: { ...workspaces, ru } }];
          }),
        );
        return { ...state, byId };
      },
    },
  ),
);
