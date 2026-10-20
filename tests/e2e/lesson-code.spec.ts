import { expect, test } from '@playwright/test';

// headless Chromium по умолчанию прячет любые полосы прокрутки, а здесь проверяем именно полосу
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('длинный SQL в уроке: у блока своя постоянная полоса прокрутки (P8.19)', async ({ page }) => {
  await page.goto('/l/inner-join');
  const pre = page.locator('pre[data-lang="sql"]').filter({ hasText: 'select book.title from book b join' });
  await expect(pre).toBeVisible({ timeout: 20_000 });
  const size = await pre.evaluate((el: HTMLElement) => ({
    overflow: el.scrollWidth - el.clientWidth,
    scrollbar: el.offsetHeight - el.clientHeight,
  }));
  expect(size.overflow).toBeGreaterThan(0);
  // Полоса из стиля урока (0,5rem), а не системная: системную macOS прячет, и обрезанная строка
  // выглядит целой. Стилизованная ::-webkit-scrollbar в Chrome и Safari видна всегда
  expect(size.scrollbar).toBe(8);
});
