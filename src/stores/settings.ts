import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeSetting = 'light' | 'dark' | 'system';

export const DEFAULT_MAIN_LAYOUT = [15, 35, 50];
export const DEFAULT_RIGHT_LAYOUT = [55, 8, 22, 15];

export interface SettingsStore {
  theme: ThemeSetting;
  mainLayout: number[];
  rightLayout: number[];
  focusMode: boolean;
  setTheme(t: ThemeSetting): void;
  setMainLayout(l: number[]): void;
  setRightLayout(l: number[]): void;
  toggleFocusMode(): void;
}

// Сохранённая раскладка могла остаться от старой версии или быть испорчена руками
export function sanitizeLayout(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length !== fallback.length) return fallback;
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) return fallback;
  const sum = (value as number[]).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 1 ? (value as number[]) : fallback;
}

function isTheme(v: unknown): v is ThemeSetting {
  return v === 'light' || v === 'dark' || v === 'system';
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'system',
      mainLayout: DEFAULT_MAIN_LAYOUT,
      rightLayout: DEFAULT_RIGHT_LAYOUT,
      focusMode: false,
      setTheme: (theme) => set({ theme }),
      setMainLayout: (mainLayout) => set({ mainLayout: sanitizeLayout(mainLayout, DEFAULT_MAIN_LAYOUT) }),
      setRightLayout: (rightLayout) =>
        set({ rightLayout: sanitizeLayout(rightLayout, DEFAULT_RIGHT_LAYOUT) }),
      toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    }),
    {
      name: 'vs-settings',
      version: 1,
      partialize: (s) => ({
        theme: s.theme,
        mainLayout: s.mainLayout,
        rightLayout: s.rightLayout,
        focusMode: s.focusMode,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof SettingsStore, unknown>>;
        return {
          ...current,
          theme: isTheme(p.theme) ? p.theme : current.theme,
          mainLayout: sanitizeLayout(p.mainLayout, DEFAULT_MAIN_LAYOUT),
          rightLayout: sanitizeLayout(p.rightLayout, DEFAULT_RIGHT_LAYOUT),
          focusMode: typeof p.focusMode === 'boolean' ? p.focusMode : current.focusMode,
        };
      },
    },
  ),
);
