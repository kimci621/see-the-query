import { expect, type Page, test } from '@playwright/test';

async function openLesson(page: Page) {
  await page.goto('/l/select-basics');
  // ждём готовности редактора и песочницы (доска поднялась)
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

async function setEditorText(page: Page, text: string) {
  const editor = page.locator('.cm-content');
  // поле редактора во всю панель: кликаем в первую строку, а не в центр, где может висеть автокомплит
  await editor.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

test('запрос: результат и фокус на доске', async ({ page }) => {
  await openLesson(page);
  const started = Date.now();
  await setEditorText(page, 'select title, price from book');
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 5000 });
  const elapsed = Date.now() - started;
  // критерий фазы: 250 мс debounce + превью; в CI запас, локально логируем
  console.log(`превью заняло ${elapsed} мс`);
  await expect(page.getByTestId('field-title')).toBeVisible();
  await expect(page.getByTestId('field-price')).toBeVisible();
  // NULL-плашка в результате
  expect(await page.locator('[data-kind="null"]').count()).toBeGreaterThan(0);
});

test('широкий результат: значения под своими заголовками', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await openLesson(page);
  await setEditorText(page, 'select * from book');
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 5000 });
  const grid = page.getByRole('table', { name: 'Результат запроса' });
  // 700px: панель уже 864px (9 колонок по 96px), результат прокручивается
  // колонки book: book_id, title, author_id, category_id, price (индекс 4)
  // таблица реально поехала вбок, иначе проверка ничего не доказывает;
  // повторяем, пока панели не досчитали ширину и скролл не стал возможен
  await expect
    .poll(() =>
      grid.evaluate((el) => {
        el.scrollLeft = 300;
        return el.scrollLeft;
      }),
    )
    .toBeGreaterThan(0);
  const head = await page.getByTestId('field-price').boundingBox();
  const cell = await page.getByTestId('cell-0-4').boundingBox();
  expect(head).not.toBeNull();
  expect(cell).not.toBeNull();
  expect(Math.abs((head?.x ?? 0) - (cell?.x ?? 99999))).toBeLessThan(2);
});

test('ошибка Postgres: подчёркнуто и объяснено', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, 'select nme from book');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible({ timeout: 5000 });
  // подчёркивание не затирается отложенным прогоном линтера (750 мс)
  await page.waitForTimeout(1200);
  await expect(page.locator('.cm-lintRange-error')).toBeVisible();
  // карточка видна сразу во вкладке «Результат», без перехода в «Сообщения»
  await expect(page.getByTestId('pg-original')).toContainText('nme');
  await expect(page.getByTestId('pg-explain-title')).toContainText(/колонк/iu);
  await expect(page.getByTestId('preview-status')).toContainText('Ошибка');
  // ошибка парсинга не мигает: после исправления панель возвращается
  await setEditorText(page, 'select name from author');
  await expect(page.getByTestId('result-count')).toHaveText('6 строк', { timeout: 5000 });
});

test('сторож в превью: карточка таймаута, без падения и без повторов', async ({ page }) => {
  await openLesson(page);
  // считаем перезапуски песочницы: зависший запрос не должен перезапускаться по кругу
  await page.evaluate(() => {
    const w = window as Window & {
      __vsSandbox?: { subscribe(l: (e: { type: string }) => void): () => void };
      __restarts?: number;
    };
    w.__restarts = 0;
    w.__vsSandbox?.subscribe((e) => {
      if (e.type === 'restarted') w.__restarts = (w.__restarts ?? 0) + 1;
    });
  });
  await setEditorText(page, 'select pg_sleep(5)');
  await expect(page.getByTestId('pg-explain-title')).toContainText('слишком долго', { timeout: 15_000 });
  await expect(page.getByTestId('preview-status')).toContainText('Ошибка');
  await expect(page.getByText('Запрос выполнялся дольше 3 секунд.', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Песочница перезапущена, твои изменения восстановлены.', { exact: true }),
  ).toHaveCount(0);
  // проверка отсутствия: ждём дольше сторожа (3 с), повторного перезапуска быть не должно
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => (window as Window & { __restarts?: number }).__restarts)).toBe(1);
  await expect(page.getByTestId('preview-status')).toContainText('Ошибка');
});

test('Tab выводит фокус из редактора к тулбару', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, 'select 1');
  await page.keyboard.press('Tab');
  // «Отменить» заблокирована при пустом журнале, поэтому первый фокусируемый после редактора - «Сброс»
  await expect(page.getByTestId('reset-button')).toBeFocused();
  await expect(page.locator('.cm-content')).toHaveText('select 1');
});

test('применить, отменить и применить всё', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, "insert into author (name) values ('Аноним') returning author_id");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('result-count')).toContainText('1', { timeout: 5000 });
  await expect(page.getByTestId('table-node-public.author').getByTestId('row-count')).toHaveText('7');
  // камера ушла на целевую таблицу оператора
  await expect(page.getByTestId('table-node-public.author')).toHaveAttribute('data-focused', 'true');

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

  // сброс требует подтверждения: сначала меняем данные, потом сбрасываем через диалог
  const authorCount = page.getByTestId('table-node-public.author').getByTestId('row-count');
  await setEditorText(page, "insert into author (name) values ('Аноним')");
  await page.getByTestId('apply-button').click();
  await expect(authorCount).toHaveText('7', { timeout: 5000 });
  await page.getByTestId('reset-button').click();
  await expect(page.getByText('Сбросить урок?')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(authorCount).toHaveText('6', { timeout: 5000 });
});

test('крупный шрифт браузера: строка результата не обрезает ячейку', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  await openLesson(page);
  await setEditorText(page, 'select title from book');
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 5000 });
  const { row, content } = await page.getByTestId('cell-0-0').evaluate((el) => ({
    row: el.parentElement?.getBoundingClientRect().height ?? 0,
    content: el.scrollHeight,
  }));
  expect(row).toBeGreaterThanOrEqual(content);
});

test('крупный шрифт браузера: текст редактора растёт вместе с ним', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  await openLesson(page);
  const size = await page
    .locator('.cm-editor')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBe(26); // 0.8125rem при корне 32px
});
