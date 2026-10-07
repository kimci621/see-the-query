import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useResolvedTheme } from '@/app/ThemeProvider';

// next-themes в проекте нет: тема берётся из useSettingsStore через useResolvedTheme
export function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
