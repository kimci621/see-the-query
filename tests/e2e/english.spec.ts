import { expect, test } from '@playwright/test';

test('язык в ссылке, переключатель и история сохраняют урок и параметры', async ({ page }) => {
  await page.goto('/l/select-basics?lang=en&source=test#part');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page).toHaveURL(/\/l\/select-basics\?lang=ru&source=test#part$/);
  await expect(page.getByRole('heading', { name: /SELECT:/ })).toBeVisible();
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
});

test('быстрая смена языка сохраняет введённый SQL', async ({ page }) => {
  await page.goto('/l/select-basics?lang=ru');
  const editor = page.getByRole('textbox', { name: 'SQL-запрос' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('select 123;');
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.getByRole('textbox', { name: 'SQL-запрос' })).toHaveText('select 123;');
});
