import { expect, test } from '@playwright/test';

test('урок составных индексов: подсчёты, планы и сортировка', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/composite-indexes');
  await expect(page.getByRole('heading', { name: 'Составные индексы' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(6);
  for (let index = 0; index < 6; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    await block.getByRole('button', { name: index === 2 ? 'Применить' : 'На доску' }).click();
    if (index === 2) {
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
      await expect(page.getByTestId('result-count')).toHaveText(
        index < 2 ? '1 строка' : index < 5 ? 'EXPLAIN' : '10 строк',
        { timeout: 20_000 },
      );
      if (index < 2) await expect(page.getByTestId('cell-0-0')).toHaveText(index === 0 ? '1696' : '56513');
      if (index === 3 || index === 4) {
        await page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' }).click();
        const dialog = page.getByRole('dialog', { name: 'Значение ячейки' });
        await expect(dialog).toContainText(index === 3 ? 'Bitmap Index Scan' : 'Seq Scan');
        await expect(dialog).toContainText(index === 3 ? '1696' : '56513');
        await page.screenshot({ path: testInfo.outputPath(`plan-${index}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
      if (index === 5) {
        await page.getByRole('tab', { name: 'План' }).click();
        await expect(page.getByTestId('plan-tree').getByText(/Index Only Scan/)).toBeVisible({
          timeout: 20_000,
        });
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
