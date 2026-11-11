import { expect, test } from '@playwright/test';

test('unnest показывает элементы и передаёт строки фильтру', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'select b.title, u.tag from book b, unnest(b.tags) as u(tag) where b.book_id = 5',
  );
  await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'UNNEST', 'WHERE', 'SELECT'], {
    timeout: 15_000,
  });
  await page.getByTestId('stage-chip').nth(1).click();
  await page.getByTestId('player-prev').click();
  const source = page.locator('[data-table-id="t:b"]');
  const child = page.locator('[data-table-id="t:u"]');
  await expect(child.getByTestId('ghost-row')).toHaveCount(21);
  await expect(child).toBeInViewport({ timeout: 10_000 });
  await expect(child).toContainText('классика');
  await expect(source.locator('.vs-col--highlight', { hasText: 'tags' })).toBeVisible();
  await expect(page.locator('.vs-bracket')).not.toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('expand.png') });
  await page.getByTestId('stage-chip').nth(3).click();
  await expect(page.getByTestId('ghost-row')).toHaveCount(3);
});
