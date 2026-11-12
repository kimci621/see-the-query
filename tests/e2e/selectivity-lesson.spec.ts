import { expect, test } from '@playwright/test';

test('урок статистики: доли, планы и ANALYZE', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/selectivity');
  await expect(page.getByRole('heading', { name: 'Селективность и статистика' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(9);
  for (let index = 0; index < 9; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = index === 2 || index === 8;
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
      await expect(page.getByTestId('result-count')).toHaveText(
        index === 3 || index === 4 ? 'EXPLAIN' : '1 строка',
        { timeout: 20_000 },
      );
      if (index < 2) await expect(page.getByTestId('cell-0-0')).toHaveText(index === 0 ? '67000' : '3000');
      if (index === 3 || index === 4) {
        await page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' }).click();
        const dialog = page.getByRole('dialog', { name: 'Значение ячейки' });
        await expect(dialog).toContainText(index === 3 ? 'Seq Scan' : 'Bitmap Index Scan');
        await expect(dialog).toContainText(index === 3 ? '67000' : '3000');
        await page.keyboard.press('Escape');
      }
      if (index === 5) await expect(page.getByTestId('cell-0-0')).toContainText('-0.');
      if (index === 6) await expect(page.getByTestId('cell-0-0')).toHaveText('1');
      if (index === 7) await expect(page.getByTestId('cell-0-0')).toContainText('paid');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
