import { expect, test } from '@playwright/test';

test('B-дерево показывает реальные страницы, планы и путь ключа', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/tests/e2e/fixtures/btree.html');
  const scene = page.getByRole('region', { name: 'Поиск в B-дереве' });
  await expect(scene).toBeVisible({ timeout: 45_000 });
  await expect(scene.getByText(/100.?000 строк в таблице/)).toBeVisible();
  const pages = scene.getByRole('img', { name: /Показано страниц:/ });
  await expect(pages).toBeVisible();
  const pageStyle = await pages.evaluate((element) => ({
    height: element.clientHeight,
    background: getComputedStyle(element.firstElementChild as Element).backgroundColor,
  }));
  expect(pageStyle.height).toBeGreaterThan(20);
  expect(pageStyle.height).toBeLessThan(300);
  expect(pageStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('table.png') });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText(/Seq Scan: просмотрено 100.?000 строк, возвращено 1/)).toBeVisible();
  await expect(scene.locator('.btree-scanner')).toHaveCSS('animation-name', 'btree-scan-x, btree-scan-y');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(scene.locator('.btree-scanner')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.screenshot({ path: testInfo.outputPath('seq.png') });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText(/Корень: страница/)).toBeVisible();
  const tree = scene.getByRole('img', { name: /Корень .* листьев/ });
  await expect(tree).toBeVisible();
  const leafColor = await tree
    .locator('span')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(leafColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('tree.png') });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText(/Ключ 5000: сначала лист/)).toBeVisible();
  await expect(scene.getByText(/Найдена запись индекса/)).toBeVisible();
  await expect(scene.getByRole('region', { name: 'Путь поиска' })).toContainText('Лист');
  await expect(scene.getByText(/План по умолчанию: Index Scan/)).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Назад' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('index.png') });
  await page.keyboard.press('ArrowLeft');
  await expect(scene.getByRole('heading', { name: 'Корень и листья B-дерева' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png') });
});
