import { expect, test } from '@playwright/test';

test('поздний фокус исходной таблицы не уводит камеру от результата сцены', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/numbers');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });
  await page
    .getByTestId('sql-block')
    .filter({ hasText: 'select 7 / 2 as int_div' })
    .getByRole('button', { name: 'На доску' })
    .click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('3', { timeout: 20_000 });
  await page
    .getByTestId('sql-block')
    .filter({ hasText: 'pages::numeric / 100' })
    .getByRole('button', { name: 'На доску' })
    .click();
  const ghost = page.getByTestId('ghost-table').filter({ hasText: '64' }).last();
  await expect(ghost).toBeInViewport({ timeout: 20_000 });
  await page.evaluate(async () => {
    const modulePath = '/src/stores/board.ts';
    const store = await import(modulePath);
    store.useBoardStore.setState({ focused: [] });
    store.useBoardStore.getState().focus(['public.book']);
  });
  await expect(ghost).toBeInViewport({ timeout: 5_000 });
  await page.waitForTimeout(1000);
  await expect(ghost).toBeInViewport();
});
