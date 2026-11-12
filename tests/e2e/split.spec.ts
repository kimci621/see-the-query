import { expect, test } from '@playwright/test';

test('сцена нормализации показывает строки PostgreSQL и обновляется после изменения', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/tests/e2e/fixtures/split.html');
  await expect(page.getByText(/Для сцены нужна исходная таблица/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Создать данные' }).click();
  const scene = page.getByRole('region', { name: 'Разделение таблицы' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await expect(scene).toContainText('шахматы, рисование');
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByRole('region', { name: 'Отдельные значения' }).locator('tbody tr')).toHaveCount(6);
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByRole('region', { name: 'student_hobby' }).locator('tbody tr')).toHaveCount(6);
  await expect(scene.locator('svg path')).toHaveCount(6);
  await expect(scene.locator('svg')).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Назад' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(scene.getByRole('region', { name: 'student_hobby' })).toContainText('шахматы');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Изменить данные' }).click();
  await expect(scene).toContainText('плавание, бег', { timeout: 20_000 });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByRole('region', { name: 'Отдельные значения' })).toContainText('бег');
  await page.getByRole('button', { name: 'Удалить колонку' }).click();
  await expect(page.getByText(/Для сцены нужна исходная таблица/)).toBeVisible({ timeout: 20_000 });
});
