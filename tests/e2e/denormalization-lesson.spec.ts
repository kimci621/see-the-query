import { expect, test } from '@playwright/test';

test('урок денормализации: рассинхрон счётчика и пересчёт', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/denormalization');
  await expect(page.getByRole('heading', { name: 'Избыточность и денормализация' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(9);
  for (let index = 0; index < 9; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [1, 2, 5, 7].includes(index);
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
        index === 0 || index === 3 ? '5 строк' : '1 строка',
        { timeout: 20_000 },
      );
      if ([4, 6, 8].includes(index)) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('Остров погибших кораблей');
        await expect(page.getByTestId('cell-0-1')).toHaveText(index === 8 ? '1' : '0', { timeout: 20_000 });
        await expect(page.getByTestId('cell-0-2')).toHaveText(index === 4 ? '0' : '1', { timeout: 20_000 });
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
