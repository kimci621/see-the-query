import { expect, test } from '@playwright/test';

test('сцена конфликта читаема, значения и ползунок доступны с клавиатуры', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/l/upsert');
  await expect(page.getByTestId('stage-chip').first()).toBeVisible({ timeout: 20_000 });
  const example = page.getByTestId('sql-block').filter({ hasText: 'do update set bonus' });
  await example.getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('stage-chip')).toHaveText(['INSERT'], { timeout: 10_000 });
  await page.getByTestId('stage-chip').first().click();
  const target = page.locator('[data-table-id="t:public.customer"]');
  const source = page.locator('[data-table-id^="i:"]');
  await expect(target).toBeVisible();
  await expect(source).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate(
        (element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth,
      ),
    )
    .toBeGreaterThanOrEqual(0.6);
  await expect(page.getByRole('slider', { name: 'Позиция в сцене' })).toBeVisible();
  const firstCell = target.locator('.vs-cell[tabindex="0"]');
  await firstCell.focus();
  await expect(page.getByRole('tooltip')).toHaveText((await firstCell.getAttribute('title')) ?? '');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tooltip')).toHaveText('Анна Смирнова');
});
