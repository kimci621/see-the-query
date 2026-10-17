import { expect, test } from '@playwright/test';

test('тёмная тема: контролы доски и редактор на токенах', async ({ page }) => {
  await page.goto('/l/select-basics');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });

  // переключение на лету, без перезагрузки
  await page.getByRole('button', { name: 'Тема оформления' }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await expect(page.locator('.react-flow')).toHaveClass(/dark/);
  const controlBg = await page
    .locator('.react-flow__controls-button')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(controlBg).not.toBe('rgb(254, 254, 254)');

  const bg = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  // у панели нет своего фона, эталон: токен --editor-bg
  const paneBg = await page
    .locator('.editor-pane')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--editor-bg').trim());
  const editorBg = await bg('.cm-editor');
  expect(editorBg).not.toBe('rgb(40, 44, 52)');
  expect(editorBg).toBe(paneBg);

  // подсветка синтаксиса живёт на токенах и не зависит от темы @uiw: ключевое слово не цвета текста
  const keywordColor = await page
    .locator('.cm-content .tok-keyword')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const textColor = await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).color);
  expect(keywordColor).not.toBe(textColor);
});
