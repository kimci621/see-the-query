import { expect, type Page, test } from '@playwright/test';

// Счётчик рендеров из src/lib/renderCount.ts (только dev)
const tableNodeRenders = () =>
  (window as { __vsRenderCounts?: Record<string, number> }).__vsRenderCounts?.tableNode ?? 0;

const QUERY = 'select title, price from book where price > 500 order by price desc limit 3';

async function openBoard(page: Page) {
  await page.goto('/l/select-basics');
  // ждём, пока песочница поднимет Postgres и доска нарисует таблицы
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

test('сцена WHERE → ORDER BY → LIMIT проигрывается до результата', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'WHERE', 'SELECT', 'ORDER BY', 'LIMIT'], {
    timeout: 5_000,
  });
  // автоплей на 2x доходит до конца: в призраке три строки
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть');
});

test('клик по чипу WHERE показывает 7 строк мгновенно', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId('stage-chip').nth(1).click();
  await expect(page.getByTestId('ghost-row')).toHaveCount(7);
  await expect(page.getByTestId('timeline-caption')).toContainText('WHERE');
});

test('базовая доска не перерисовывается во время сцены', async ({ page }) => {
  // Камера выключена: при onlyRenderVisibleElements сдвиг вьюпорта монтирует ноды, это не перерисовка доски
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: true, followCamera: false }, version: 0 }),
    );
  });
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  const before = await page.evaluate(tableNodeRenders);
  // проигрываем сцену заново и скрабим: TableNode не должен рендериться
  await page.getByTestId('player-toggle').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('stage-chip').nth(0).click();
  await page.getByTestId('stage-chip').nth(3).click();
  const after = await page.evaluate(tableNodeRenders);
  expect(after).toBe(before);
});

test('Esc на доске закрывает сцену и снимает приглушение', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  // у самого слоя нулевой размер, видимость проверяем по призраку
  await expect(page.getByTestId('ghost-table').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('board-area').focus();
  await page.keyboard.press('Escape');
  // призраки растворяются, слой остаётся пустым
  await expect(page.getByTestId('ghost-table')).toHaveCount(0);
  await expect(page.getByTestId('board-canvas')).not.toHaveAttribute('data-dimmed');
});

test('при открытии урока сцена спрятана, доска не гаснет; плеер её возвращает', async ({ page }) => {
  await openBoard(page);
  await expect(page.getByTestId('stage-chip').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).not.toHaveAttribute('data-dimmed');
  await expect(page.getByTestId('ghost-table')).toHaveCount(0);
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('ghost-table').first()).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-dimmed', 'true');
});

test('после Esc клик по чипу снова показывает сцену', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId('board-area').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ghost-table')).toHaveCount(0);
  await page.getByTestId('stage-chip').nth(1).click();
  await expect(page.getByTestId('ghost-row')).toHaveCount(7);
});
