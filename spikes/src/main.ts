// Выбор спайка по ?spike=worker|parser|board
const spike = new URLSearchParams(location.search).get('spike');
const out = document.getElementById('out') as HTMLPreElement;

export function report(data: unknown) {
  (window as unknown as { __spike: unknown }).__spike = data;
  out.textContent = JSON.stringify(data, null, 2);
}

if (spike === 'worker') import('./worker-spike').then((m) => m.run());
if (spike === 'parser') import('./parser-spike').then((m) => m.run());
if (spike === 'board') import('./board-spike').then((m) => m.run());
