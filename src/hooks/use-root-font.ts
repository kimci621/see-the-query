import { useSyncExternalStore } from 'react';

// Корневой размер шрифта страницы, px; вне браузера (тесты в Node) 16
export const readRootFont = () =>
  (typeof document !== 'undefined' &&
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize)) ||
  16;

// Живая смена шрифта браузера (спека 10): ни matchMedia, ни rem-минимумы панелей её не замечают.
// Один ResizeObserver на всё приложение следит за элементом шириной 1rem, пока есть подписчики
let current = readRootFont();
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:1rem;height:0';
    document.body.append(probe);
    const observer = new ResizeObserver(() => {
      const px = readRootFont();
      if (px === current) return;
      current = px;
      for (const l of listeners) l();
    });
    observer.observe(probe);
    stop = () => {
      observer.disconnect();
      probe.remove();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}

export function useRootFont(): number {
  return useSyncExternalStore(subscribe, () => current);
}

// react-resizable-panels переводит rem в px только при ресайзе группы. Размер панели отдаём в px
// от корня: смена шрифта меняет проп, панель перерегистрируется, группа пересчитывает ограничения
export function remToPx(size: string, rootFont: number): string {
  return size.endsWith('rem') ? `${Number.parseFloat(size) * rootFont}px` : size;
}
