import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

test('урок CTE: граница заказов не зависит от часового пояса браузера', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/cte');
  await expect(page.getByRole('heading', { name: 'CTE и WITH' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('result-count')).toHaveText('2 строки', { timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    await block.getByRole('button', { name: 'На доску' }).click();
    if (index === 3) {
      await expect(page.getByRole('region', { name: 'Результат' })).toContainText('42P01', {
        timeout: 20_000,
      });
    } else {
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const modulePath = '/src/stores/scene.ts';
              const store = await import(modulePath);
              return store.useSceneStore.getState().trace?.sql;
            }),
          { timeout: 20_000 },
        )
        .toBe(sql);
      await expect(page.getByTestId('result-count')).toHaveText(index === 1 ? '1 строка' : '2 строки', {
        timeout: 20_000,
      });
      if (index === 1) await expect(page.getByTestId('cell-0-0')).toHaveText('7');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
