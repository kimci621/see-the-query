import { expect, type Page, test } from '@playwright/test';

async function openBoard(page: Page) {
  await page.goto('/l/select-basics');
  // ждём, пока песочница поднимет Postgres и доска нарисует таблицы
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.author')).toBeVisible({ timeout: 20_000 });
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

const ON = 'on b.author_id = a.author_id';

test.describe('сцены JOIN и GROUP BY', () => {
  test('INNER JOIN: чипы стадий, подпись с парами, итог 9 строк', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, `select b.title, a.name from book b join author a ${ON}`);
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'FROM', 'INNER JOIN', 'SELECT'], {
      timeout: 5_000,
    });
    await waitSceneEnd(page, 9);
    await expect(page.getByTestId('board-area')).toHaveScreenshot('inner-join-final.png', {
      maxDiffPixelRatio: 0.02,
    });
    await page.getByTestId('stage-chip').nth(2).click();
    await expect(page.getByTestId('timeline-caption')).toContainText('INNER JOIN: 9 пар');
  });

  test('LEFT JOIN: у книг без автора NULL в правой половине', async ({ page }) => {
    await openBoard(page);
    await typeQuery(page, `select b.title, a.name from book b left join author a ${ON}`);
    await waitSceneEnd(page, 11);
    await expect(page.locator('.vs-ghost .vs-null')).toHaveCount(2);
    await expect(page.getByTestId('board-area')).toHaveScreenshot('left-join-final.png', {
      maxDiffPixelRatio: 0.02,
    });
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
    await expect(page.getByTestId('board-area')).toHaveScreenshot('group-by-final.png', {
      maxDiffPixelRatio: 0.02,
    });
    await page.getByTestId('stage-chip').nth(1).click();
    await expect(page.getByTestId('timeline-caption')).toContainText('11 строк → 6 групп');
    // шаг назад: фаза стопок, скобка на каждую группу
    await page.getByTestId('player-prev').click();
    await expect(page.getByTestId('deco-bracket')).toHaveCount(6);
  });
});
