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

// Тихие ошибки при наборе (P8.15): имя на полуслове не краснеет до паузы, без FROM объяснение про FROM,
// карточка разбора нейтральная, как плашка «Недописан»
test('набор: на полуслове «Недописан», после паузы ошибка; без FROM и разбор', async ({ page }) => {
  await openLesson(page);
  const status = page.getByTestId('preview-status');
  const card = page.getByTestId('pg-error');
  await setEditorText(page, 'select ti');
  await expect(card).toHaveAttribute('data-tone', 'neutral', { timeout: 5000 });
  await expect(status).toContainText('Недописан');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
  // пауза набора 800 мс: теперь это ошибка ученика
  await expect(card).toHaveAttribute('data-tone', 'error', { timeout: 3000 });
  await expect(status).toContainText('Ошибка');
  await expect(page.locator('.cm-lintRange-error')).toBeVisible();

  await setEditorText(page, 'select title, pr');
  await expect(page.getByTestId('pg-explain-title')).toHaveText(/^Запрос без FROM/, { timeout: 5000 });
  await expect(page.getByTestId('pg-explain-suggestion')).toHaveText('title есть в book: допиши from book.');
  await expect(page.getByTestId('pg-original')).toContainText('column "title" does not exist');

  await setEditorText(page, 'select title from book where');
  await expect(status).toContainText('Недописан', { timeout: 5000 });
  await expect(card).toHaveAttribute('data-tone', 'neutral');
  await page.waitForTimeout(1000);
  await expect(card).toHaveAttribute('data-tone', 'neutral');
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
  await expect(page.getByTestId('pg-explain-title')).toContainText('Запрос выполнялся дольше 3 секунд', {
    timeout: 15_000,
  });
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

test('после «Применить» превью не повторяет оператор: CREATE без «уже есть», INSERT с тем же id', async ({
  page,
}) => {
  await openLesson(page);
  await setEditorText(page, 'create table mine (id int)');
  await expect(page.getByTestId('preview-status')).toContainText('Превью', { timeout: 5000 });
  const apply = page.getByTestId('apply-button');
  await apply.click();
  await expect(apply).toContainText('Применено', { timeout: 5000 });
  await expect(page.getByTestId('result-count')).toHaveText('CREATE');
  // дольше паузы превью (250 мс) и возврата камеры (0,8 с): карточки 42P07 нет
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('pg-explain-title')).toHaveCount(0);
  await expect(page.getByTestId('preview-status')).not.toContainText('Ошибка');
  // повтор в состоянии «Применено» ничего не пишет
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForTimeout(500);
  await expect(page.getByText('Записано в базу', { exact: true })).toHaveCount(1);

  await setEditorText(page, "insert into author (name) values ('Аноним') returning author_id");
  await expect(apply).toContainText('Применить', { timeout: 5000 });
  await apply.click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('7', { timeout: 5000 });
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('cell-0-0')).toHaveText('7');
  await expect(page.getByTestId('table-node-public.author').getByTestId('row-count')).toHaveText('7');
});

test('страховка DML: без WHERE, ошибка превью, пометка строк, тост отмены', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, 'update book set price = 0');
  await expect(page.getByTestId('preview-status')).toContainText('изменятся все 11 строк', { timeout: 5000 });
  await setEditorText(page, 'delete from author');
  await expect(page.getByTestId('preview-status')).toContainText('Ошибка', { timeout: 5000 });
  await expect(page.getByTestId('apply-button')).toHaveAttribute('data-variant', 'outline');

  const author = page.getByTestId('table-node-public.author');
  await setEditorText(page, "insert into author (name) values ('Аноним')");
  await page.getByTestId('apply-button').click();
  await expect(author.locator('[data-mark="new"]')).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByText('Записано в базу', { exact: true })).toBeVisible();
  await setEditorText(page, "update author set name = 'Икс' where author_id = 2");
  await page.getByTestId('apply-button').click();
  await expect(author.locator('[data-mark="changed"]')).toHaveCount(1, { timeout: 5000 });
  // пометка прошлого запроса снята правкой текста, тост записи один
  await expect(author.locator('[data-mark="new"]')).toHaveCount(0);
  await expect(page.getByText('Записано в базу', { exact: true })).toHaveCount(1);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('Отменено: UPDATE', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Записано в базу', { exact: true })).toHaveCount(0);
  await expect(author.locator('[data-mark]')).toHaveCount(0);
});

test('применить, отменить и применить всё', async ({ page }) => {
  await openLesson(page);
  await setEditorText(page, "insert into author (name) values ('Аноним') returning author_id");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('result-count')).toHaveText('INSERT: 1', { timeout: 5000 });
  await expect(page.getByTestId('table-node-public.author').getByTestId('row-count')).toHaveText('7');
  // камера ушла на целевую таблицу оператора
  await expect(page.getByTestId('table-node-public.author')).toHaveAttribute('data-focused', 'true');

  // пустой редактор: у запроса была бы сцена, и камера, если успеет за ней, уйдёт от author к призраку;
  // доска рисует только ноды в кадре, и строки author тогда не найти
  await setEditorText(page, '');
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
