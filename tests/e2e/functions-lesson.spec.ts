import { expect, test } from '@playwright/test';

test('урок функций и процедур: расчёт и изменение бонуса', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/functions');
  await expect(page.getByRole('heading', { name: 'Функции и процедуры' })).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(10);
  for (let index = 0; index < 10; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [1, 5, 7, 8].includes(index);
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
        index === 0 || index === 6 ? '2 строки' : '1 строка',
        {
          timeout: 20_000,
        },
      );
      if (index === 2) await expect(page.getByTestId('cell-0-0')).toHaveText('130');
      if (index === 3) await expect(page.getByTestId('cell-0-0')).toHaveText('120');
      if (index === 4) await expect(page.getByTestId('cell-0-0')).toHaveText('NULL');
      if (index === 6) {
        await expect(page.getByTestId('cell-0-1')).toHaveText('бонус: 120');
        await expect(page.getByTestId('cell-1-1')).toHaveText('без бонуса');
      }
      if (index === 9) await expect(page.getByTestId('cell-0-1')).toHaveText('130');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
