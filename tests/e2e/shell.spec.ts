import { expect, test } from '@playwright/test';

test('навигация по урокам, поиск, режим фокуса', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/l\/how-to-use$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Как пользоваться доской' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Соседние уроки' }).getByRole('link').click();
  await expect(page).toHaveURL(/\/l\/select-basics$/);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Урок, тема, ключевое слово SQL...').fill('доска');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/l\/how-to-use$/);

  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByText(/Заглушка урока/)).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByText(/Заглушка урока/)).toBeVisible();
});

test('раскладка и тема переживают перезагрузку', async ({ page }) => {
  await page.goto('/l/how-to-use');
  await page.getByRole('button', { name: 'Тема оформления' }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vs-settings') ?? '{}'));
  expect(saved.state.mainLayout).toHaveLength(3);
});

test('шрифт Geist содержит кириллицу', async ({ page }) => {
  await page.goto('/l/how-to-use');
  // Сабсеты грузятся лениво: просим браузер загрузить кириллицу явно, иначе check() даст false
  await page.evaluate(() =>
    Promise.all([
      document.fonts.load('16px "Geist Variable"', 'Привет'),
      document.fonts.load('16px "Geist Mono Variable"', 'Привет'),
    ]),
  );
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(
    () =>
      document.fonts.check('16px "Geist Variable"', 'Привет') &&
      document.fonts.check('16px "Geist Mono Variable"', 'Привет'),
  );
  expect(ok).toBe(true);
});

test('SQL-блок урока подсвечен и несёт мету', async ({ page }) => {
  await page.goto('/l/how-to-use');
  const pre = page.locator('pre[data-lang="sql"]').first();
  await expect(pre).toHaveAttribute('data-meta', 'run expect=rows:11');
  await expect(pre).toHaveClass(/shiki/);
});
