import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { type ThemeSetting, useSettingsStore } from '@/stores/settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function prefersDark() {
  return window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(theme: ThemeSetting, prefersDarkScheme: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDarkScheme ? 'dark' : 'light';
  return theme;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSettingsStore((s) => s.theme);
  const dark = useSyncExternalStore(subscribe, prefersDark, () => false);
  return resolveTheme(theme, dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [resolved]);
  return <>{children}</>;
}
