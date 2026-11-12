import { expect, test } from '@playwright/test';

test('урок B-tree: сравнение планов и создание индекса', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/btree-seq-vs-index');
  await expect(page.getByRole('heading', { name: 'B-tree, Seq Scan и Index Scan' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 45_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(7);
  for (let index = 0; index < 7; index++) {
    await blocks
      .nth(index)
      .getByRole('button', { name: index === 3 ? 'Применить' : 'На доску' })
      .click();
    if (index === 3) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
    } else {
      const count =
        index === 0 || index === 6 ? '1 строка' : index === 1 || index === 4 ? '5 строк' : '10 строк';
      await expect(page.getByTestId('result-count')).toHaveText(count, { timeout: 20_000 });
      if (index === 0 || index === 2) await expect(page.getByTestId('cell-0-0')).toHaveText('5000');
      if (index === 6) await expect(page.getByTestId('cell-0-0')).toHaveText('100000');
      if (index === 1 || index === 4) {
        await page.getByRole('tab', { name: 'План' }).click();
        const plan = page.getByTestId('plan-tree');
        if (index === 1) {
          await expect(plan.getByText(/Seq Scan по public.orders/)).toBeVisible();
          await expect(plan.getByText(/прочитано 100.?000 строк/)).toBeVisible();
        } else {
          await expect(plan.getByText(/Index Scan/).first()).toBeVisible({ timeout: 20_000 });
        }
        await page.getByRole('tab', { name: 'Результат' }).click();
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
    if (index === 2) {
      const scene = page.getByRole('region', { name: 'Поиск в B-дереве' });
      await expect(scene).toBeVisible({ timeout: 45_000 });
      for (let step = 0; step < 3; step++) await scene.getByRole('button', { name: 'Дальше' }).click();
      await expect(scene.getByRole('region', { name: 'Путь поиска' })).toContainText('Ключ 5000');
      await page.screenshot({ path: testInfo.outputPath('scene.png') });
    }
  }
});
