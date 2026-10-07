import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveTheme, ThemeProvider } from '@/app/ThemeProvider';
import { useSettingsStore } from '@/stores/settings';

describe('resolveTheme', () => {
  it('system следует за системой', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('явная тема важнее системы', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('ThemeProvider', () => {
  it('вешает класс dark на html при тёмной теме и снимает при светлой', () => {
    render(
      <ThemeProvider>
        <p>текст</p>
      </ThemeProvider>,
    );
    act(() => useSettingsStore.getState().setTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => useSettingsStore.getState().setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
