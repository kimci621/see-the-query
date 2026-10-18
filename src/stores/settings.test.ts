import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIN_LAYOUT,
  DEFAULT_RIGHT_LAYOUT,
  sanitizeLayout,
  useSettingsStore,
} from '@/stores/settings';

describe('sanitizeLayout', () => {
  it('пропускает корректную раскладку', () => {
    expect(sanitizeLayout([20, 30, 50], DEFAULT_MAIN_LAYOUT)).toEqual([20, 30, 50]);
  });

  it('другая длина → дефолт', () => {
    expect(sanitizeLayout([50, 50], DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
  });

  it('NaN, ноль, отрицательное, не число → дефолт', () => {
    expect(sanitizeLayout([Number.NaN, 50, 50], DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
    expect(sanitizeLayout([0, 50, 50], DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
    expect(sanitizeLayout(['15', 35, 50], DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
    expect(sanitizeLayout(null, DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
  });

  it('сумма не 100 → дефолт', () => {
    expect(sanitizeLayout([10, 10, 10], DEFAULT_MAIN_LAYOUT)).toEqual(DEFAULT_MAIN_LAYOUT);
  });
});

describe('useSettingsStore', () => {
  it('битый vs-settings в localStorage не ломает стор', async () => {
    localStorage.setItem(
      'vs-settings',
      JSON.stringify({
        state: { theme: 'purple', mainLayout: [50, 50], rightLayout: 'x', focusMode: 'yes' },
        version: 1,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.theme).toBe('system');
    expect(s.mainLayout).toEqual(DEFAULT_MAIN_LAYOUT);
    expect(s.rightLayout).toEqual(DEFAULT_RIGHT_LAYOUT);
    expect(s.focusMode).toBe(false);
  });

  it('раскладка версии 1 (заглушка таймлайна) сбрасывается на дефолт, остальное сохраняется', async () => {
    localStorage.setItem(
      'vs-settings',
      JSON.stringify({
        state: { theme: 'dark', mainLayout: [20, 30, 50], rightLayout: [55, 8, 22, 15], focusMode: true },
        version: 1,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    const s = useSettingsStore.getState();
    expect(s.rightLayout).toEqual(DEFAULT_RIGHT_LAYOUT);
    expect(s.theme).toBe('dark');
    expect(s.mainLayout).toEqual([20, 30, 50]);
    expect(s.focusMode).toBe(true);
    useSettingsStore.setState({ theme: 'system', mainLayout: DEFAULT_MAIN_LAYOUT, focusMode: false });
  });

  it('раскладка версии 2 из трёх панелей (таймлайн был спрятан) сбрасывается на дефолт', async () => {
    localStorage.setItem('vs-settings', JSON.stringify({ state: { rightLayout: [52, 18, 30] }, version: 2 }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().rightLayout).toEqual(DEFAULT_RIGHT_LAYOUT);
  });

  it('toggleFocusMode переключает режим', () => {
    const before = useSettingsStore.getState().focusMode;
    useSettingsStore.getState().toggleFocusMode();
    expect(useSettingsStore.getState().focusMode).toBe(!before);
  });
});
