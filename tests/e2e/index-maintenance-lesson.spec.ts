import { expect, test } from '@playwright/test';

test('урок обслуживания индексов: CONCURRENTLY и удаление', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/index-maintenance');
  await expect(page.getByRole('heading', { name: 'Обслуживание индексов' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('table-node-public.customer')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(7);
  for (let index = 0; index < 7; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = index === 3 || index === 5;
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
    } else if (index === 2) {
      await expect(page.getByRole('region', { name: 'Результат' })).toContainText('25001', {
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
      await expect(page.getByTestId('result-count')).toHaveText(
        index === 4 ? '3 строки' : index === 6 ? '2 строки' : '1 строка',
        { timeout: 20_000 },
      );
      if (index === 0) await expect(page.getByTestId('cell-0-0')).toHaveText('40');
      if (index === 1) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('orders_pkey');
        await expect(page.getByTestId('cell-0-1')).toHaveText('0');
      }
      if (index === 4) await expect(page.getByTestId('cell-0-0')).toHaveText('customer_bonus_idx');
      if (index === 6) await expect(page.getByTestId('cell-0-0')).toHaveText('customer_email_key');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
