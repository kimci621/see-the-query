import { expect, type Page, test } from '@playwright/test';

async function apply(page: Page, sql: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(sql);
  const button = page.getByTestId('apply-button');
  await expect(button).toContainText('Применить', { timeout: 15_000 });
  await button.click();
  await expect(button).toContainText('Применено', { timeout: 15_000 });
}

async function focus(page: Page, id: string) {
  await page.evaluate(async (tableId) => {
    const modulePath = '/src/stores/board.ts';
    const store = await import(modulePath);
    store.useBoardStore.getState().focus([tableId]);
    store.useBoardStore.getState().requestFrame();
  }, id);
  await expect(page.getByTestId(`table-node-${id}`)).toBeInViewport({ timeout: 15_000 });
}

test('представления показывают запрос, зависимости и расхождения снимка', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await apply(page, 'create view v_expensive as select book_id, title, price from book where price > 1000');
  const view = page.getByTestId('table-node-public.v_expensive');
  await expect(view).toHaveAttribute('data-kind', 'view', { timeout: 15_000 });
  await expect(view.getByText('VIEW', { exact: true })).toBeVisible();
  await expect(view.getByTestId('view-definition')).toContainText('SELECT');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modulePath = '/src/stores/board.ts';
        const store = await import(modulePath);
        return store.useBoardStore.getState().schema?.viewDeps;
      }),
    )
    .toContainEqual({ tableId: 'public.book', viewId: 'public.v_expensive' });
  const edge = page.locator('.react-flow__edge-smoothstep .react-flow__edge-path');
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveCSS('stroke-dasharray', '5px, 4px');
  await focus(page, 'public.v_expensive');
  await page.screenshot({ path: testInfo.outputPath('view.png') });

  await apply(
    page,
    'create materialized view mv_expensive as select book_id, title, price from book where price > 1000',
  );
  const snapshot = page.getByTestId('table-node-public.mv_expensive');
  await expect(snapshot).toHaveAttribute('data-kind', 'matview', { timeout: 15_000 });
  await expect(snapshot.getByText('Совпадает')).toBeVisible({ timeout: 15_000 });
  await focus(page, 'public.mv_expensive');
  await page.screenshot({ path: testInfo.outputPath('fresh.png') });

  await apply(page, 'update book set price = 1500 where book_id = 6');
  await focus(page, 'public.mv_expensive');
  await expect(snapshot.getByText('1 различие')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('stale.png') });

  await apply(page, 'update book set price = 2401 where book_id = 2');
  await focus(page, 'public.mv_expensive');
  await expect(snapshot.getByText('3 различия')).toBeVisible({ timeout: 15_000 });
  await apply(page, 'refresh materialized view mv_expensive');
  await focus(page, 'public.mv_expensive');
  await expect(snapshot.getByText('Совпадает')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('refreshed.png') });
});
