import { expect, test } from '@playwright/test';

test('урок секционирования: маршрутизация и секция по умолчанию', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/partitioning');
  await expect(page.getByRole('heading', { name: 'Секционирование таблиц' })).toBeVisible({
    timeout: 30_000,
  });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(10);
  for (let index = 0; index < 10; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [0, 1, 2, 4, 7, 8].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
    } else if (index === 6) {
      const result = page.getByRole('region', { name: 'Результат' });
      await expect(result).toContainText('23514', { timeout: 20_000 });
      await expect(result).toContainText('Нет подходящей секции');
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
      if (index === 3) {
        await expect(page.getByTestId('timeline-caption')).toContainText('строк: 2, секций: 2', {
          timeout: 20_000,
        });
        const may = page.locator('[data-testid="ghost-table"][data-table-id="t:public.measurement_2024_05"]');
        const june = page.locator(
          '[data-testid="ghost-table"][data-table-id="t:public.measurement_2024_06"]',
        );
        await expect(may).toContainText('2024-05-10');
        await expect(june).toContainText('2024-06-15');
      } else {
        await expect(page.getByTestId('result-count')).toHaveText(index === 5 ? '2 строки' : '3 строки', {
          timeout: 20_000,
        });
        await expect(page.getByTestId('cell-0-0')).toHaveText(
          index === 5 ? 'measurement_2024_05' : 'measurement_default',
        );
        await expect(page.getByTestId(`cell-${index === 5 ? 1 : 2}-0`)).toHaveText('measurement_2024_06');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
