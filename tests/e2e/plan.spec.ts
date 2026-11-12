import { expect, test } from '@playwright/test';

test('план большого набора показывает реальные строки и связан со сценой', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/select-basics');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tab', { name: 'План' })).toHaveCount(0);
  await page.evaluate(async () => {
    const sandbox = (
      window as unknown as { __vsSandbox: { loadLesson(id: string, journal: string[]): Promise<void> } }
    ).__vsSandbox;
    await sandbox.loadLesson('big_bookstore', []);
  });
  const editor = page.locator('.cm-content');
  await editor.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('select order_id from orders where customer_id = 42');
  const planTab = page.getByRole('tab', { name: 'План' });
  await expect(planTab).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('result-count')).toHaveText('5 строк', { timeout: 15_000 });
  await planTab.click();
  const plan = page.getByTestId('plan-tree');
  await expect(plan.getByText(/прочитано 100.?000 строк/)).toBeVisible();
  const scan = plan.getByRole('button', { name: /Seq Scan по public.orders/ });
  await scan.hover();
  await expect(page.getByTestId('stage-chip').first()).toHaveAttribute('data-plan-hover', 'true');
  await page.screenshot({ path: testInfo.outputPath('plan.png') });
  await scan.focus();
  await expect(page.getByTestId('stage-chip').first()).toHaveAttribute('data-plan-hover', 'true');
  await page.getByRole('tab', { name: 'Результат' }).click();
  await expect(page.getByTestId('stage-chip').first()).toHaveAttribute('data-plan-hover', 'false');
  await editor.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('select random()');
  await expect(planTab).toHaveCount(0, { timeout: 15_000 });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText('see-the-query рассчитан на экран от 640 px')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-guard.png') });
});
