import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeSetting = 'light' | 'dark' | 'system';

export interface SettingsStore {
  theme: ThemeSetting;
  setTheme(t: ThemeSetting): void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'vs-settings', version: 1 },
  ),
);
