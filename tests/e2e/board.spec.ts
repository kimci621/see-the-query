import { expect, type Page, test } from '@playwright/test';

async function openBookstore(page: Page) {
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

test('bookstore разложен без наложений, FK и рамка схемы на месте', async ({ page }) => {
  await openBookstore(page);
  const nodes = page.locator('[data-testid^="table-node-"]');
  await expect(nodes).toHaveCount(8);
  const boxes = await nodes.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-testid'), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  for (const a of boxes) {
    for (const b of boxes) {
      if (a.id === b.id) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} перекрывает ${b.id}`).toBe(false);
    }
  }
  await expect(page.locator('.react-flow__edge-fk')).toHaveCount(9);
  await expect(page.getByTestId('schema-group-public')).toBeVisible();
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('row-count')).toHaveText('11');
  expect(await book.locator('[data-kind="null"]').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('pg-version')).toHaveText(/^PostgreSQL 18\.\d+ в браузере$/);
  await expect(page.getByTestId('board-skeleton')).toHaveCount(0);
});

test('камера урока переживает перезагрузку, ⌘0 вписывает доску', async ({ page }) => {
  await openBookstore(page);
  const viewport = page.locator('.react-flow__viewport');
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').state?.byId?.['select-basics']?.viewport ??
          null,
      ),
    )
    .not.toBeNull();
  const zoomed = await viewport.getAttribute('style');

  await page.reload();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await expect(viewport).toHaveAttribute('style', zoomed ?? '');

  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoomed);
});
