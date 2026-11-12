import { expect, test } from '@playwright/test';

test('урок MVCC: новая версия, очистка и жизнь страницы', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/mvcc');
  await expect(page.getByRole('heading', { name: 'MVCC и версии строк' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(6);
  await blocks.nth(0).getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('cell-0-2')).toHaveText('890.00', { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('example-1.png') });
  await blocks.nth(1).getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('field-ctid')).toBeVisible({ timeout: 15_000 });
  const oldCtid = await page.getByTestId('cell-0-1').innerText();
  const oldXmin = await page.getByTestId('cell-0-2').innerText();
  await page.screenshot({ path: testInfo.outputPath('example-2.png') });
  await blocks.nth(2).getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
  await expect(page.getByTestId('cell-0-1')).toHaveText('900.00');
  await page.screenshot({ path: testInfo.outputPath('example-3.png') });
  await blocks.nth(3).getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('field-ctid')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('cell-0-1')).not.toHaveText(oldCtid);
  await expect(page.getByTestId('cell-0-2')).not.toHaveText(oldXmin);
  await page.screenshot({ path: testInfo.outputPath('example-4.png') });
  const scene = page.getByRole('region', { name: 'Версии строк PostgreSQL' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  for (let index = 0; index < 6; index++) {
    await page.screenshot({ path: testInfo.outputPath(`scene-${index + 1}.png`) });
    if (index < 5) await scene.getByRole('button', { name: 'Дальше' }).click();
  }
  await expect(scene.getByText('VACUUM освободил ненужные версии', { exact: true })).toBeVisible();
  await blocks.nth(4).getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('example-5.png') });
  await blocks.nth(5).getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('cell-0-2')).toHaveText('900.00', { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('example-6.png') });
});
