import { expect, test } from '@playwright/test';

test('сцена показывает ожидание и освобождение блокировки', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/tests/e2e/fixtures/sessions.html?id=lock-for-update');
  const scene = page.getByRole('region', { name: 'Ожидание блокировки строки' });
  const waiting = scene.locator('[data-step="3"]');
  await expect(waiting).toHaveAttribute('data-state', 'pending');
  for (let i = 0; i < 3; i++) await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(waiting).toHaveAttribute('data-state', 'running');
  await expect(scene.getByText('B ждёт завершения транзакции A.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('waiting.png'), fullPage: true });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(waiting).toHaveAttribute('data-state', 'done');
  await expect(scene.getByText('B получила блокировку после COMMIT A.')).toBeVisible();
  await expect(scene.getByText('B ждёт завершения транзакции A.')).toHaveCount(0);
  await scene.getByRole('button', { name: 'Дальше' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(waiting).toHaveAttribute('data-state', 'running');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('сцена взаимной блокировки показывает ошибку только после её шага', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/sessions.html?id=deadlock');
  const scene = page.getByRole('region', { name: 'Взаимная блокировка' });
  await expect(scene.getByText('Ошибка 40P01')).toHaveCount(0);
  for (let i = 0; i < 7; i++) await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText('Ошибка 40P01')).toBeVisible();
  await expect(scene.getByText('Завершилось ошибкой')).toBeVisible();
  await expect(scene.getByText(/PostgreSQL может выбрать другую транзакцию/)).toBeVisible();
});
