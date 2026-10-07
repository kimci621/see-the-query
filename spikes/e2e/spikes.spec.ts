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
