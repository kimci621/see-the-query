import { expect, type Page, test } from '@playwright/test';

async function openLesson(page: Page) {
  await page.goto('/l/select-basics');
  // ждём готовности редактора и песочницы (доска поднялась)
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

async function setEditorText(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

test('запрос: результат и фокус на доске', async ({ page }) => {
  await openLesson(page);
  const started = Date.now();
  await setEditorText(page, 'select title, price from book');
  await expect(page.getByTestId('result-count')).toHaveText('11', { timeout: 5000 });
  const elapsed = Date.now() - started;
  // критерий фазы: 250 мс debounce + превью; в CI запас, локально логируем
  console.log(`превью заняло ${elapsed} мс`);
  await expect(page.getByTestId('field-title')).toBeVisible();
  await expect(page.getByTestId('field-price')).toBeVisible();
  // NULL-плашка в результате
  expect(await page.locator('[data-kind="null"]').count()).toBeGreaterThan(0);
});

test('ошибка Postgres: подчёркнуто и объяснено', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, 'select nme from book');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible({ timeout: 5000 });
  await page.getByRole('tab', { name: 'Сообщения' }).click();
  await expect(page.getByTestId('pg-original')).toContainText('nme');
  await expect(page.getByTestId('pg-explain-title')).toContainText(/колонк/iu);
  // ошибка парсинга не мигает: после исправления панель возвращается
  await setEditorText(page, 'select name from author');
  await expect(page.getByTestId('result-count')).toHaveText('6', { timeout: 5000 });
});

test('применить, отменить и применить всё', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, "insert into author (name) values ('Аноним') returning author_id");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('result-count')).toContainText('1', { timeout: 5000 });
  await expect(page.getByTestId('table-node-public.author').getByTestId('row-count')).toHaveText('7');

  await setEditorText(page, 'select 1');
  // фокус вне редактора: клик по фону страницы
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('table-node-public.author').getByTestId('row-count')).toHaveText('6', {
    timeout: 5000,
  });

  await setEditorText(page, 'select 1; select 2');
  await page.getByTestId('apply-all-button').click();
  await expect(page.getByTestId('preview-status')).toContainText('Превью', { timeout: 5000 });
});
