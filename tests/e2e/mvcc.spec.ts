import { expect, test } from '@playwright/test';

test('сцена MVCC показывает версии страницы и результат SELECT', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/tests/e2e/fixtures/mvcc.html');
  const scene = page.getByRole('region', { name: 'Версии строк PostgreSQL' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  const pageRows = scene.getByRole('region', { name: 'Версии на странице' });
  const visible = scene.getByRole('region', { name: 'Видит SELECT' });
  await expect(scene.getByText('Три вставленные строки', { exact: true })).toBeVisible();
  await expect(pageRows.getByText('видна')).toHaveCount(3);
  await expect(pageRows.locator('tbody tr').first().locator('td').nth(2)).toHaveText('0');
  await expect(visible.locator('tbody tr')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('step-1.png') });

  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText('UPDATE создал новую версию строки 1', { exact: true })).toBeVisible();
  await expect(pageRows.getByText('устарела')).toHaveCount(1);
  await expect(visible.getByText('a2')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('step-2.png') });

  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(pageRows.getByText('устарела')).toHaveCount(2);
  await expect(visible.locator('tbody tr')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('step-3.png') });

  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(pageRows.getByText('отменена')).toHaveCount(1);
  await expect(visible.getByText('c', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('step-4.png') });

  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(pageRows.getByText('след блокировки')).toBeVisible();
  await expect(scene.getByText('Транзакция уже завершена', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('step-5.png') });

  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText('VACUUM освободил ненужные версии', { exact: true })).toBeVisible();
  await expect(pageRows.getByText('устарела')).toHaveCount(0);
  await expect(pageRows.getByText('отменена')).toHaveCount(0);
  await expect(scene.getByRole('button', { name: 'Назад' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('step-6.png') });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(scene).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png') });
});
