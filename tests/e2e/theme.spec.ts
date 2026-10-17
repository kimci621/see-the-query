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

test('тёмная тема: автокомплит редактора на токенах, а не на светлой теме CodeMirror', async ({ page }) => {
  await page.goto('/l/select-basics');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  // схема приходит асинхронно и пересобирает автокомплит: открытый список перерисуется,
  // и проверки стилей поймают уже отцепленный элемент. Ждём схему (таблицы на доске) до набора
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Тема оформления' }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' sel');
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await expect(tooltip).toBeVisible();
  // у ключевых слов буква, а не ключ: ключ на доске значит PK
  const icon = await tooltip
    .locator('.cm-completionIcon-keyword')
    .first()
    .evaluate((el) => getComputedStyle(el, '::after').content);
  expect(icon).toBe('"K"');

  // эталон: вычисленные токены, посчитанные браузером так же, как для стилей редактора
  const token = (name: string) =>
    page.evaluate((n) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = `var(--${n})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, name);
  const popover = await token('popover');
  const accent = await token('accent');
  expect(await tooltip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(popover);
  expect(popover).not.toBe('rgb(245, 245, 245)');
  const selected = await tooltip
    .locator('li[aria-selected]')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(selected).toBe(accent);
  expect(selected).not.toBe('rgb(17, 119, 204)');
});
