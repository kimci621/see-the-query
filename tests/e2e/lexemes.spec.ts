import { expect, test } from '@playwright/test';

test('сцена лексем использует словари PostgreSQL и доступна с клавиатуры', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/tests/e2e/fixtures/lexemes.html');
  const scene = page.getByRole('region', { name: 'Разбор текста для поиска' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  const tokens = scene.getByRole('list', { name: 'Токены' });
  await expect(tokens).toContainText('о стоп-слово');
  await page.screenshot({ path: testInfo.outputPath('tokens.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowRight');
  const mapping = scene.getByRole('list', { name: 'Лексемы токенов' });
  await expect(mapping).toContainText('читаем');
  await expect(mapping).toContainText('чита');
  await page.keyboard.press('ArrowRight');
  await expect(scene).toContainText("'чита':4,5,7");
  await expect(scene.getByRole('button', { name: 'Назад' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('vector.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Конфигурация simple' }).click();
  await expect(scene).toContainText('simple', { timeout: 20_000 });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByRole('list', { name: 'Токены' })).not.toContainText('стоп-слово');
});
