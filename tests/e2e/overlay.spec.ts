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

test('«На доску» и «Дальше» из урока проигрывают сцену, и на последнем шаге тоже', async ({ page }) => {
  await page.goto('/l/how-to-use');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const block = page.getByTestId('sql-block').filter({ hasText: 'select title, price from book;' });
  await block.getByRole('button', { name: 'На доску' }).click();
  await expect(page.getByTestId('ghost-table').first()).toBeVisible({ timeout: 10_000 });
  // в сцене sql-блок шага с кнопкой: rehype видит блоки внутри компонентов MDX
  const scene = page.getByRole('region', { name: 'Сцена' });
  await scene.getByRole('button', { name: 'На доску' }).click();
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('3 строки', { timeout: 10_000 });
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
});

test('кадр сцены вмещает счётчик LIMIT и оставляет снизу место под хром доски', async ({ page }) => {
  await page.goto('/l/logical-order');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await typeQuery(
    page,
    'select title, price * 0.9 as sale from book where price > 1000 order by sale desc limit 2',
  );
  await expect(page.getByTestId('ghost-row')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
  // камера доезжает за долю секунды после последней фазы
  await page.waitForTimeout(800);
  const board = await page.getByTestId('board-area').boundingBox();
  const counter = await page.getByTestId('deco-counter').boundingBox();
  const ghost = await page.getByTestId('ghost-table').boundingBox();
  const chrome = await page.locator('.react-flow__controls').boundingBox();
  expect((counter?.x ?? 0) + (counter?.width ?? 0)).toBeLessThanOrEqual(
    (board?.x ?? 0) + (board?.width ?? 0),
  );
  expect((ghost?.y ?? 0) + (ghost?.height ?? 0)).toBeLessThanOrEqual(chrome?.y ?? 0);
});

test('после запроса с ошибкой камера возвращается к таблице, доска не пустая', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  // камера ушла к призраку: базовая book вне кадра
  await expect(page.getByTestId('table-node-public.book')).not.toBeInViewport({ timeout: 5_000 });
  await typeQuery(page, 'select title from book where price == 890');
  await expect(page.getByTestId('final-only-note')).toContainText('ошибкой', { timeout: 5_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeInViewport({ timeout: 5_000 });
});

test('переход из урока со сценой не сдвигает сохранённую камеру другого урока', async ({ page }) => {
  const viewport = () => page.locator('.react-flow__viewport').getAttribute('style');
  // сохраняем камеру null-logic колесом над доской
  await page.goto('/l/null-logic');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1000);
  const saved = await viewport();
  // в другом уроке сцену запускает пользователь, камера следит за призраком
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  // переход по сайдбару: фокус на ссылке, сцену стартового запроса запустил не пользователь
  await page.locator('a[href="/l/null-logic"]').click();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2500);
  expect(await viewport()).toBe(saved);
});
