import { expect, test } from '@playwright/test';

test('урок блокировок: режимы и взаимное ожидание', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/locks');
  await expect(page.getByRole('heading', { name: 'Блокировки и deadlock' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await blocks
      .nth(index)
      .getByRole('button', { name: index ? 'Применить' : 'На доску' })
      .click();
    if (index) await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText(index === 4 ? '2 строки' : '1 строка', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('cell-0-0')).toHaveText('1');
    if (index === 4) await expect(page.getByTestId('cell-1-0')).toHaveText('2');
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  const lock = page.getByRole('region', { name: 'Ожидание блокировки строки' });
  for (let i = 0; i < 3; i++) await lock.getByRole('button', { name: 'Дальше' }).click();
  await expect(lock.locator('[data-step="3"]')).toHaveAttribute('data-state', 'running');
  await page.screenshot({ path: testInfo.outputPath('scene-wait.png') });
  await lock.getByRole('button', { name: 'Дальше' }).click();
  await expect(lock.getByText('B получила блокировку после COMMIT A.')).toBeVisible();
  const deadlock = page.getByRole('region', { name: 'Взаимная блокировка' });
  for (let i = 0; i < 7; i++) await deadlock.getByRole('button', { name: 'Дальше' }).click();
  await expect(deadlock.getByText('Ошибка 40P01')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('scene-deadlock.png') });
});
