import { expect, test } from '@playwright/test';

test('урок типов индексов: GIN, BRIN и Hash', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/index-types');
  await expect(page.getByRole('heading', { name: 'GIN, GiST, BRIN и Hash' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(10);
  for (let index = 0; index < 10; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [1, 2, 5, 8].includes(index);
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
        index === 4 || index === 7 ? 'EXPLAIN' : '1 строка',
        { timeout: 20_000 },
      );
      if ([0, 3, 6, 9].includes(index)) {
        const expected = index === 0 ? '16667' : index === 3 ? '1' : index === 6 ? '288' : '42';
        await expect(page.getByTestId('cell-0-0')).toHaveText(expected);
      }
      if (index === 4 || index === 7) {
        await page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' }).click();
        const dialog = page.getByRole('dialog', { name: 'Значение ячейки' });
        await expect(dialog).toContainText(index === 4 ? 'book_title_trgm_idx' : 'orders_created_brin_idx');
        await expect(dialog).toContainText(
          index === 4 ? 'Bitmap Index Scan' : 'Rows Removed by Index Recheck',
        );
        await page.screenshot({ path: testInfo.outputPath(`plan-${index}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
