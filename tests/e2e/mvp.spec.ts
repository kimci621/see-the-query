import { expect, type Page, test } from '@playwright/test';

async function openLesson(page: Page, id: string) {
  await page.goto(`/l/${id}`);
  await expect(page.getByTestId('board')).toBeVisible();
  // PGlite поднимается до 15 с (факты Ф0)
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
}

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

test('полный путь: урок → «На доску» → правка → сцена → результат', async ({ page }) => {
  await openLesson(page, 'inner-join');

  // 1. Пример из теории уходит в редактор и играет сцену INNER JOIN
  await page.getByTestId('sql-block').nth(1).getByRole('button', { name: 'На доску' }).click();
  await expect(page.locator('.cm-content')).toContainText('join author');
  await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'FROM', 'INNER JOIN', 'SELECT'], {
    timeout: 10_000,
  });
  await expect(page.getByTestId('ghost-row')).toHaveCount(9, { timeout: 15_000 });

  // 2. Сцена пошагово: прыжок к итогу JOIN, шаг назад к фазам до слияния:
  // строки без пары уходят, совпавшие пары соединены линиями (критерий успеха 2)
  await page.getByTestId('stage-chip').nth(2).click();
  await expect(page.getByTestId('timeline-caption')).toContainText('INNER JOIN: 9 пар');
  await page.getByTestId('player-prev').click();
  await expect(page.getByTestId('timeline-caption')).toContainText('строки без пары уходят');
  await expect(page.getByTestId('deco-pair-line')).toHaveCount(9);
  await page.getByTestId('player-prev').click();
  await expect(page.getByTestId('timeline-caption')).toContainText('совпавшие ключи соединены линиями');

  // 3. Правка в редакторе: INNER → LEFT, сцена перестраивается сама
  await typeQuery(
    page,
    'select b.title, a.name from book b left join author a on a.author_id = b.author_id;',
  );
  await expect(page.getByTestId('stage-chip').nth(2)).toHaveText('LEFT JOIN', { timeout: 10_000 });
  await expect(page.getByTestId('ghost-row')).toHaveCount(11, { timeout: 15_000 });

  // 4. Результат: 11 строк (критерий успеха 5: «Простой Python» остался в LEFT)
  await expect(page.getByTestId('ghost-row').filter({ hasText: 'Простой Python' })).toHaveCount(1);
  await expect(page.getByTestId('result-count')).toHaveText('11 строк');
});

test('урок отмечается пройденным после запуска примера и дочитывания', async ({ page }) => {
  await openLesson(page, 'how-to-use');

  // запустили пример
  await page.getByRole('button', { name: 'На доску' }).first().click();
  await expect(page.getByTestId('ghost-row').first()).toBeVisible({ timeout: 10_000 });

  // дочитали до метки конца
  await page.locator('[data-lesson-end]').scrollIntoViewIfNeeded();
  const link = page.getByRole('link', { name: /Как пользоваться доской/ });
  await expect(link.getByLabel('пройден')).toBeVisible({ timeout: 5_000 });
});

test('select * from book фокусирует таблицу и подсвечивает колонки (критерий 1)', async ({ page }) => {
  await openLesson(page, 'how-to-use');
  await typeQuery(page, 'select * from book;');
  const node = page.getByTestId('table-node-public.book');
  await expect(node).toHaveAttribute('data-focused', 'true', { timeout: 5_000 });
  await expect(node.locator('[data-column="title"][data-highlighted="true"]')).toBeVisible();
  await expect(page.getByTestId('result-count')).toHaveText('11 строк');
});
