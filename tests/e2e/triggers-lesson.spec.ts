import { expect, test } from '@playwright/test';

test('урок триггеров: предпросмотр, журнал и условие WHEN', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/triggers');
  await expect(page.getByRole('heading', { name: 'Триггеры' })).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(10);
  for (let index = 0; index < 10; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [1, 2, 3, 6, 8].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
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
      await expect(page.getByTestId('result-count')).toHaveText(index === 4 ? 'UPDATE: 1' : '1 строка', {
        timeout: 20_000,
      });
      if (index === 0) await expect(page.getByTestId('cell-0-2')).toHaveText('890.00');
      if (index === 4) {
        await expect(page.getByTestId('timeline-caption')).toContainText('возможный триггер book_price_log', {
          timeout: 20_000,
        });
        const ghost = page.locator('[data-testid="ghost-table"][data-table-id="t:public.price_log"]');
        await expect(ghost).toContainText('Добавлено: price_log');
        await expect(ghost).toContainText('890.00');
        await expect(ghost).toContainText('900.00');
      }
      if (index === 5) await expect(page.getByTestId('cell-0-0')).toHaveText('0');
      if (index === 7) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('1');
        await expect(page.getByTestId('cell-0-1')).toHaveText('890.00');
        await expect(page.getByTestId('cell-0-2')).toHaveText('900.00');
      }
      if (index === 9) await expect(page.getByTestId('cell-0-0')).toHaveText('1');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
