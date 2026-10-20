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

test('вердикты WHERE: значок и плашка UNKNOWN не ложатся на ячейки, длинный текст с многоточием', async ({
  page,
}) => {
  await openBoard(page);
  await typeQuery(page, 'select * from book where price > 500');
  await expect(page.getByTestId('stage-chip')).toContainText(['FROM', 'WHERE'], { timeout: 5_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
  // конец WHERE и шаг назад: кадр вердиктов
  await page.getByTestId('stage-chip').nth(1).click();
  await page.getByTestId('player-prev').click();
  await expect(page.locator('.vs-row-badge')).toHaveText(['UNKNOWN']);
  const overlaps = await page.getByTestId('ghost-row').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const cellsRight = Math.max(
        ...Array.from(row.querySelectorAll('.vs-cell')).map((c) => c.getBoundingClientRect().right),
      );
      return Array.from(row.querySelectorAll('.vs-row-icon, .vs-row-badge'))
        .filter((m) => m.getBoundingClientRect().left < cellsRight - 0.5)
        .map((m) => `${row.getAttribute('data-row-key')}: ${m.textContent}`);
    }),
  );
  expect(overlaps).toEqual([]);
  const cell = page.locator('.vs-ghost .vs-cell').first();
  await expect(cell).toHaveCSS('text-overflow', 'ellipsis');
  await expect(cell).toHaveCSS('display', 'block');
});

test('вердикты WHERE: текст отсеянных строк зачёркнут', async ({ page }) => {
  await openBoard(page);
  await typeQuery(page, 'select title, price from book where price > 500');
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
  await page.getByTestId('stage-chip').nth(1).click();
  await page.getByTestId('player-prev').click();
  // ячейки спозиционированы абсолютно и не наследуют зачёркивание строки
  const cell = page.locator('.vs-row--dropped .vs-cell').first();
  await expect(cell).toHaveCSS('text-decoration-line', 'line-through');
});

test('«На доску» из урока проигрывает сцену, даже если фокус ушёл с кнопки до трассы (P8.19)', async ({
  page,
}) => {
  await page.goto('/l/how-to-use');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const block = page.getByTestId('sql-block').filter({ hasText: 'select title, price from book;' });
  await block.getByRole('button', { name: 'На доску' }).click();
  // раньше паузы превью фокус уходит на заголовок урока, вне редактора и примера
  await page.locator('#lesson-title').focus();
  await expect(page.getByTestId('ghost-table').first()).toBeVisible({ timeout: 10_000 });
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
  // Камера доски из transform вьюпорта и камера урока из стора: сравниваем числа, а не строку стиля
  const camera = async () => {
    const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
    const [, x, y, zoom] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(style) ?? [];
    return [x, y, zoom].map((v) => Math.round(Number(v) * 100) / 100);
  };
  const saved = () =>
    page.evaluate(() => {
      const v = JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').state?.byId?.['null-logic']?.viewport;
      return v ? [v.x, v.y, v.zoom].map((n: number) => Math.round(n * 100) / 100) : null;
    });
  // сохраняем камеру null-logic колесом над доской, когда стартовый запрос урока уже оттрассирован
  await page.goto('/l/null-logic');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stage-chip').first()).toBeVisible({ timeout: 10_000 });
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(saved, { timeout: 5_000 }).not.toBeNull();
  const kept = await saved();
  // в другом уроке сцену запускает пользователь, камера следит за призраком
  await openBoard(page);
  await typeQuery(page, QUERY);
  await expect(page.getByTestId('ghost-row')).toHaveCount(3, { timeout: 10_000 });
  // переход по сайдбару: фокус на ссылке, сцену стартового запроса запустил не пользователь
  await page.locator('a[href="/l/null-logic"]').click();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 10_000 });
  await expect.poll(camera, { timeout: 5_000 }).toEqual(kept);
  // Проверка «камера не сдвинулась»: ждать нечего, кроме паузы возврата (RETURN_DELAY_MS 800) и полёта.
  // Часы Playwright тут не помогают: на открытый документ SPA не ставятся, а с первой загрузки стопорят motion
  await page.waitForTimeout(2_000);
  expect(await camera()).toEqual(kept);
});

// Клик по «+N колонки» во время сцены разворачивает и призраки: призрак свёрнут как нода (P8.18), иначе
// развёрнутая нода торчит из-под свёрнутого призрака (P8.17)
test('«+N колонки» во время сцены разворачивает и призрак, как select *', async ({ page }) => {
  // Камера стоит на book: иначе она уходит к призраку, а нода вне кадра не рисуется
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: true, followCamera: false }, version: 0 }),
    );
  });
  await openBoard(page);
  await typeQuery(page, 'select title from book where price > 500');
  await expect(page.getByTestId('ghost-row').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('stage-chip').first().click();
  await expect(page.getByTestId('ghost-folded').first()).toBeVisible();
  await page.getByTestId('table-node-public.book').getByTestId('hidden-columns').click();
  await expect(page.getByTestId('table-node-public.book').locator('[data-column]')).toHaveCount(9);
  await expect(page.getByTestId('ghost-folded')).toHaveCount(0);
  await expect(page.getByTestId('ghost-table').first()).toBeVisible();
});
