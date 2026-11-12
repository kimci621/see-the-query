import { expect, test } from '@playwright/test';

test('урок видов индексов: уникальность, выражение и INCLUDE', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/index-variants');
  await expect(page.getByRole('heading', { name: 'Виды индексов' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(9);
  for (let index = 0; index < 9; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [2, 5, 7].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
    } else if (index === 1) {
      const result = page.getByRole('region', { name: 'Результат' });
      await expect(result).toContainText('23505', { timeout: 20_000 });
      await expect(page.getByTestId('final-only-note')).toContainText('«Результат»');
      await expect(result).toContainText('повторяющиеся значения');
      await expect(result).not.toContainText('ON CONFLICT');
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
        index === 3 ? '5 строк' : index === 6 || index === 8 ? 'EXPLAIN' : '1 строка',
        { timeout: 20_000 },
      );
      if (index === 0) await expect(page.getByTestId('cell-0-0')).toHaveText('5');
      if (index === 4) await expect(page.getByTestId('cell-0-1')).toHaveText('User42@Example.com');
      if (index === 6 || index === 8) {
        await page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' }).click();
        const dialog = page.getByRole('dialog', { name: 'Значение ячейки' });
        await expect(dialog).toContainText(
          index === 6 ? 'customer_lower_email_idx' : 'orders_customer_cover_idx',
        );
        if (index === 8) {
          await expect(dialog).toContainText('Index Only Scan');
          await expect(dialog).toContainText('Heap Fetches');
        }
        await page.screenshot({ path: testInfo.outputPath(`plan-${index}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
