declare global {
  interface Window {
    __vsRenderCounts?: Record<string, number>;
  }
}

// Только для dev и e2e: считает рендеры компонента, в проде вызов ничего не делает
export function bumpRenderCount(name: string): void {
  if (!import.meta.env.DEV) return;
  const counts = window.__vsRenderCounts ?? {};
  counts[name] = (counts[name] ?? 0) + 1;
  window.__vsRenderCounts = counts;
}
