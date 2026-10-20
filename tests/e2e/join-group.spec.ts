import { expect, type Page, test } from '@playwright/test';

async function openBoard(page: Page) {
  await page.goto('/l/select-basics');
  // ждём, пока песочница поднимет Postgres и доска нарисует таблицы
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  // author на старте вне кадра и не рисуется, ждём book
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

// Сцена доиграла: плеер снова предлагает «Играть»
async function waitSceneEnd(page: Page, rows: number) {
  await expect(page.getByTestId('ghost-row')).toHaveCount(rows, { timeout: 15_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
}

// Эталоны сняты на macOS; в CI (Linux) другие шрифты, там снимок не сверяем
async function expectBoardShot(page: Page, name: string) {
  if (process.platform !== 'darwin') return;
  await expect(page.getByTestId('board-area')).toHaveScreenshot(name, { maxDiffPixelRatio: 0.02 });
}

const ON = 'on b.author_id = a.author_id';

test.describe('сцены JOIN и GROUP BY', () => {
  test('INNER JOIN: чипы стадий, подпись с парами, итог 9 строк', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, `select b.title, a.name from book b join author a ${ON}`);
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'FROM', 'INNER JOIN', 'SELECT'], {
      timeout: 5_000,
    });
    await waitSceneEnd(page, 9);
    await expectBoardShot(page, 'inner-join-final.png');
    await page.getByTestId('stage-chip').nth(2).click();
    await expect(page.getByTestId('timeline-caption')).toContainText('INNER JOIN: 9 пар');
    // P8.62: спрятаны колонки book, её заглушка стоит перед колонками author, а не в конце
    const stub = await page.getByTestId('ghost-folded').boundingBox();
    const name = await page.locator('.vs-ghost .vs-colhead', { hasText: /^name$/ }).boundingBox();
    expect(stub?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(name?.x ?? 0);
  });

  test('LEFT JOIN: у книг без автора NULL в правой половине', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, `select b.title, a.name from book b left join author a ${ON}`);
    await waitSceneEnd(page, 11);
    await expect(page.locator('.vs-ghost .vs-null')).toHaveCount(2);
    await expectBoardShot(page, 'left-join-final.png');
  });

  test('FULL JOIN: NULL с обеих сторон, 12 строк', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, `select b.title, a.name from book b full join author a ${ON}`);
    await waitSceneEnd(page, 12);
    // две книги без автора и автор без книг
    await expect(page.locator('.vs-ghost .vs-null')).toHaveCount(3);
  });

  test('GROUP BY: чипы, стопки со скобками, строки-группы', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, 'select author_id, count(*) from book group by author_id');
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'GROUP BY', 'SELECT'], {
      timeout: 5_000,
    });
    await waitSceneEnd(page, 6);
    await expectBoardShot(page, 'group-by-final.png');
    await page.getByTestId('stage-chip').nth(1).click();
    await expect(page.getByTestId('timeline-caption')).toContainText('11 строк → 6 групп');
    // шаг назад: фаза стопок, скобка на каждую группу
    await page.getByTestId('player-prev').click();
    await expect(page.getByTestId('deco-bracket')).toHaveCount(6);
  });

  test('агрегат без GROUP BY: значение набегает, NULL в count(col) серый', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, 'select count(*), count(price) from book');
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'COUNT +1', 'SELECT'], {
      timeout: 5_000,
    });
    await waitSceneEnd(page, 1);
    // конец стадии агрегата и шаг назад со схлопывания: последняя строка стопки уже посчитана
    await page.getByTestId('stage-chip').nth(1).click();
    await page.getByTestId('player-prev').click();
    await expect(page.getByTestId('timeline-caption')).toHaveText(
      'Агрегат без GROUP BY: count(*) = 11, count(price) = 10',
    );
    await expect(page.locator('.vs-ghost .vs-row--unknown')).toHaveCount(1);
  });

  test('42803: колонка вне GROUP BY красная в стопках групп', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, 'select title, count(*) from book group by author_id');
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'ОШИБКА'], { timeout: 5_000 });
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('deco-bracket')).toHaveCount(6);
    await expect(page.getByTestId('timeline-caption')).toContainText('разные значения title');
  });

  test('42803 без GROUP BY: призрак ложится на свёрнутую ноду book и лежит над ней', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, 'select title, max(price) from book');
    await expect(page.getByTestId('stage-chip')).toHaveText(['ОШИБКА'], { timeout: 5_000 });
    const ghost = page.getByTestId('ghost-table');
    await expect(ghost).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
      timeout: 15_000,
    });
    const node = page.getByTestId('table-node-public.book');
    // колонки и заглушка как у ноды: 5 видимых и «+4 колонки»
    await expect(ghost.locator('.vs-colhead:not(.vs-folded)')).toHaveCount(5);
    await expect(page.getByTestId('ghost-folded')).toHaveText(
      await node.getByTestId('hidden-columns').innerText(),
    );
    const g = await ghost.boundingBox();
    const n = await node.boundingBox();
    expect(Math.abs((g?.x ?? 0) - (n?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((g?.width ?? 0) - (n?.width ?? 0))).toBeLessThan(2);
    // слой сцены над нодой: в точке заголовка призрака сверху призрак, а не приглушённая нода
    // elementFromPoint пропускает слой с pointer-events: none, для замера включаем их
    await page.addStyleTag({ content: '.vs-overlay, .vs-overlay * { pointer-events: auto !important; }' });
    const top = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
      [(g?.x ?? 0) + 20, (g?.y ?? 0) + 10],
    );
    expect(top).toBe('ghost-table');
  });
});
