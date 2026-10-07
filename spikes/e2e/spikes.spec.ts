import { test, expect } from '@playwright/test';
import { writeFileSync, readdirSync, statSync } from 'node:fs';

async function spikeResult(page: import('@playwright/test').Page, name: string) {
  await page.goto(`/?spike=${name}`);
  await page.waitForFunction(() => (window as any).__spike?.done === true, null, { timeout: 110_000 });
  return page.evaluate(() => (window as any).__spike);
}

test('worker: PGlite в Web Worker', async ({ page }) => {
  const r = await spikeResult(page, 'worker');
  // размер wasm в сборке
  const assets = readdirSync('dist/assets').filter((f) => f.endsWith('.wasm') || f.endsWith('.data'));
  r.assets = assets.map((f) => ({ f, kb: Math.round(statSync(`dist/assets/${f}`).size / 1024) }));
  writeFileSync('results/worker.json', JSON.stringify(r, null, 2));
  expect.soft(r.version).toContain('PostgreSQL 18');
  expect.soft(r.timeoutCode).toBe('VS001');
  expect(r.countAfterRecover).toBe(11);
});

test('parser: libpg-query в браузере', async ({ page }) => {
  const r = await spikeResult(page, 'parser');
  writeFileSync('results/parser.json', JSON.stringify(r, null, 2));
  expect(r.byteLoc).toBe(28);
  expect(r.charLoc).toBe(22);
  expect(r.charAtLoc).toBe('b.title');
  expect.soft(r.parseMs).toBeLessThan(5);
});

test('board: fps и совпадение оверлея с доской', async ({ page }) => {
  await page.goto('/?spike=board');
  await page.waitForFunction(() => (window as any).__spike?.ready === true);
  await page.waitForTimeout(1000);

  // fps за окно времени по requestAnimationFrame
  const measureFps = (ms: number) =>
    page.evaluate((ms) => new Promise<number>((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < ms) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    }), ms);

  const idleFps = await measureFps(2000);
  const rendersBefore = await page.evaluate(() => (window as any).__renders());

  // панорамирование мышью во время анимации
  const panFpsPromise = measureFps(2000);
  await page.mouse.move(600, 400);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(600 - i * 10, 400 - i * 5);
  await page.mouse.up();
  const panFps = await panFpsPromise;

  // зум колесом, затем камера с t0 в кадре (иначе onlyRenderVisibleElements выгружает ноду) и сверка прямоугольников
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__rf.setViewport({ x: 120, y: 90, zoom: 1.37 }));
  await page.waitForTimeout(300);
  const diff = await page.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="t0"]')!.getBoundingClientRect();
    const g = document.querySelector('[data-ghost="t0"]')!.getBoundingClientRect();
    return Math.max(Math.abs(n.x - g.x), Math.abs(n.y - g.y), Math.abs(n.width - g.width));
  });
  const rendersAfter = await page.evaluate(() => (window as any).__renders());

  const r = { idleFps, panFps, maxAlignDiffPx: Number(diff.toFixed(2)), tableRendersDuringAnimation: rendersAfter - rendersBefore, nodes: 30, animatedRows: 200 };
  writeFileSync('results/board.json', JSON.stringify(r, null, 2));
  expect(r.maxAlignDiffPx).toBeLessThan(1);
  expect.soft(r.panFps).toBeGreaterThanOrEqual(55);
});
