import { expect, test } from '@playwright/test';

// Запуск: pnpm e2e:perf (в CI не гоняется: headless-браузер не даёт честных fps)
test('@perf pan/zoom во время анимации держит ≥55 fps', async ({ page }) => {
  // медленная скорость, чтобы анимация шла всё время замера
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 0.5, autoplay: true, followCamera: false }, version: 0 }),
    );
  });
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });

  await page.locator('.cm-content').click();
  await page.keyboard.insertText('select title, price from book where price > 500 order by price desc');
  await expect(page.getByTestId('ghost-table').first()).toBeVisible({ timeout: 10_000 });

  // считаем кадры requestAnimationFrame 2 секунды, пока крутим колесо над доской
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (t: number) => {
          frames += 1;
          if (t - start < 2000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (t - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  const box = await page.getByTestId('board-area').boundingBox();
  if (!box) throw new Error('доска не найдена');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, i % 2 === 0 ? 120 : -120);
    await page.waitForTimeout(80);
  }
  const value = await fps;
  console.log(`fps: ${value.toFixed(1)}`);
  expect(value).toBeGreaterThanOrEqual(55);
});
