import { expect, test } from '@playwright/test';

test('урок размеров и каталогов: результаты запросов к PostgreSQL', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/sizes-catalogs');
  await expect(page.getByRole('heading', { name: 'Размеры и системные каталоги' })).toBeVisible({
    timeout: 30_000,
  });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(7);
  for (let index = 0; index < 7; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    await block.getByRole('button', { name: 'На доску' }).click();
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
    const count = index === 0 ? '2 строки' : index === 4 ? '9 строк' : index >= 5 ? '3 строки' : '1 строка';
    await expect(page.getByTestId('result-count')).toHaveText(count, { timeout: 20_000 });
    if (index !== 1) await expect(page.getByTestId('final-only-note')).toBeVisible();
    if (index === 0) {
      await expect(page.getByTestId('cell-0-0')).toHaveText('book');
      await expect(page.getByTestId('cell-1-0')).toHaveText('order_item');
    }
    if (index === 4) {
      await expect(page.getByTestId('cell-0-0')).toHaveText('book_id');
      await expect(page.getByTestId('cell-0-1')).toHaveText('bigint');
      await expect(page.getByTestId('cell-8-0')).toHaveText('meta');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
