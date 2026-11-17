import { expect, type Page, test } from '@playwright/test';

// Крупный шрифт браузера (P8.14, P8.112, WCAG 1.4.4): редактор, сетка результата, ноды доски и
// призраки растут вместе с корневым размером шрифта и ничего не наезжает. При крупном тексте
// правая колонка переходит в компактные вкладки, поэтому проверки идут по активной вкладке

const BOOK = 'table-node-public.book';

async function openLesson(page: Page) {
  // Камера сцены увела бы кадр к призраку, и book размонтировалась бы (onlyRenderVisibleElements)
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: true, followCamera: false }, version: 0 }),
    );
  });
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('board-area')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(BOOK)).toBeVisible({ timeout: 20_000 });
}

// В компактном режиме панели живут во вкладках; в обычном вкладок нет и клик не нужен
async function openTab(page: Page, name: 'Доска' | 'Редактор' | 'Результат') {
  const tab = page.getByRole('tab', { name });
  if ((await tab.count()) > 0) await tab.click();
}

async function typeQuery(page: Page, sql: string) {
  await openTab(page, 'Редактор');
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

const rootFont = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));

// Нарушения раскладки доски и призрака: пересечения строк, обрезанный текст, заглушка «+N колонки»
async function boardProblems(page: Page): Promise<string[]> {
  return page.evaluate((book) => {
    const problems: string[] = [];
    const overlap = (name: string, els: Element[]) => {
      for (let i = 1; i < els.length; i++) {
        const a = els[i - 1].getBoundingClientRect();
        const b = els[i].getBoundingClientRect();
        if (b.top < a.bottom - 0.5) problems.push(`${name}: строки ${i - 1} и ${i} пересекаются`);
      }
    };
    const clipped = (name: string, els: Element[]) => {
      for (const el of els) {
        if (el.scrollHeight > el.clientHeight + 1)
          problems.push(`${name}: обрезан текст «${el.textContent}»`);
      }
    };
    const inside = (name: string, inner: Element | null, outer: Element | null) => {
      if (!inner || !outer) return problems.push(`${name}: нет элемента`);
      const a = inner.getBoundingClientRect();
      const b = outer.getBoundingClientRect();
      // 2px допуска: заглушка заходит под рамку таблицы (1px при зуме до 2), рамку режет overflow
      if (a.left < b.left - 2 || a.right > b.right + 2 || a.top < b.top - 2 || a.bottom > b.bottom + 2)
        problems.push(`${name}: выходит за таблицу`);
      if (inner.scrollWidth > inner.clientWidth + 1) problems.push(`${name}: текст шире заглушки`);
    };

    const node = document.querySelector(`[data-testid="${book}"]`);
    const rows = Array.from(node?.querySelectorAll('[data-row]') ?? []);
    if (rows.length === 0) problems.push('доска: нет строк');
    overlap('доска', rows);
    clipped(
      'доска',
      rows.flatMap((r) => Array.from(r.children)),
    );
    clipped('шапка доски', Array.from(node?.querySelectorAll('.vs-col-head') ?? []));
    inside('заглушка доски', node?.querySelector('[data-testid="hidden-columns"]') ?? null, node);

    const ghost = document.querySelector('[data-testid="ghost-table"]');
    const ghostRows = Array.from(document.querySelectorAll('[data-testid="ghost-row"]'));
    if (ghostRows.length === 0) problems.push('призрак: нет строк');
    overlap('призрак', ghostRows);
    clipped('призрак', Array.from(ghost?.querySelectorAll('.vs-cell, .vs-colhead') ?? []));
    inside('заглушка призрака', ghost?.querySelector('[data-testid="ghost-folded"]') ?? null, ghost);
    return problems;
  }, BOOK);
}

async function gridProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const rows = Array.from(document.querySelectorAll('[role="row"][data-testid^="row-"]'));
    if (rows.length === 0) return ['результат: нет строк'];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].getBoundingClientRect();
      const b = rows[i].getBoundingClientRect();
      if (b.top < a.bottom - 0.5) problems.push(`результат: строки ${i - 1} и ${i} пересекаются`);
    }
    for (const row of rows) {
      for (const cell of Array.from(row.children)) {
        if (cell.scrollHeight > cell.clientHeight + 1)
          problems.push(`результат: обрезан текст «${cell.textContent}»`);
      }
    }
    return problems;
  });
}

// Размеры, которые должны идти от корня: высота строки ноды и призрака
async function boardSizes(page: Page) {
  return page.evaluate((book) => {
    const px = (el: Element | null) => (el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN);
    const row = document.querySelector(`[data-testid="${book}"] [data-row]`) as HTMLElement | null;
    const ghostRow = document.querySelector('[data-testid="ghost-row"]') as HTMLElement | null;
    const ghostCell = ghostRow?.querySelector('.vs-cell') ?? null;
    return {
      row: row?.offsetHeight ?? Number.NaN,
      ghostRow: ghostRow?.offsetHeight ?? Number.NaN,
      ghostFont: px(ghostCell),
    };
  }, BOOK);
}

async function editorSizes(page: Page) {
  return page.evaluate(() => {
    const px = (el: Element | null) => (el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN);
    return {
      editor: px(document.querySelector('.cm-content')),
      gutter: px(document.querySelector('.cm-gutterElement')),
    };
  });
}

// Ждём конца сцены: автоплей дошёл до последнего шага
async function sceneDone(page: Page) {
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 10_000,
  });
}

test('200% текста: компактные вкладки, подпись шага и доска целиком', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  await openLesson(page);
  expect(await rootFont(page)).toBe(32);
  await expect(page.getByTestId('workspace-tabs')).toBeVisible();

  await typeQuery(page, 'select title from book');
  await openTab(page, 'Доска');
  await sceneDone(page);
  // Стоим на шаге FROM: призрак целиком, со свёрнутыми колонками book
  await page.getByTestId('stage-chip').first().click();
  await expect(page.getByTestId('ghost-folded')).toBeVisible();

  // Подпись шага не сплющена: она над доской и участвует в раскладке
  const caption = await page.getByTestId('timeline-caption').boundingBox();
  expect(caption?.height ?? 0).toBeGreaterThan(0);

  // Таблица целиком в кадре доски, хром доски не ложится на данные
  const board = await page.getByTestId('board-area').boundingBox();
  const table = await page.getByTestId(BOOK).boundingBox();
  if (!board || !table) throw new Error('нет доски или таблицы');
  expect(table.x).toBeGreaterThanOrEqual(board.x - 2);
  expect(table.y).toBeGreaterThanOrEqual(board.y - 2);
  expect(table.x + table.width).toBeLessThanOrEqual(board.x + board.width + 2);
  expect(table.y + table.height).toBeLessThanOrEqual(board.y + board.height + 2);
  await expect(page.getByTestId('pg-version')).toHaveCount(0);
  await expect(page.locator('.react-flow__controls')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Вписать доску в экран' })).toBeVisible();
  expect(await boardProblems(page)).toEqual([]);

  // Вкладки не размонтируют панели: редактор и результат переживают переходы
  await openTab(page, 'Редактор');
  expect(await editorSizes(page)).toEqual({ editor: 26, gutter: 26 });
  await openTab(page, 'Результат');
  await expect(page.getByTestId('result-count')).toHaveText('11 строк');
  await expect.poll(() => gridProblems(page)).toEqual([]);
  await openTab(page, 'Доска');
  await expect(page.getByTestId(BOOK)).toBeVisible();

  // Теория открывается в Sheet и возвращает фокус на кнопку
  await page.getByRole('button', { name: 'Теория' }).click();
  await expect(page.getByRole('dialog', { name: 'Теория' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Теория' })).toBeFocused();
});

test('живая смена шрифта: доска, призрак и сетка пересчитываются без перезагрузки', async ({ page }) => {
  await openLesson(page);
  await typeQuery(page, 'select title from book');
  await openTab(page, 'Доска');
  await sceneDone(page);
  await page.getByTestId('stage-chip').first().click();
  await expect(page.getByTestId('ghost-folded')).toBeVisible();
  expect(await boardSizes(page)).toEqual({ row: 24, ghostRow: 24, ghostFont: 12 });

  await openTab(page, 'Редактор');
  expect(await editorSizes(page)).toEqual({ editor: 13, gutter: 13 });

  // Пользователь меняет размер шрифта: корень 16px → 32px, страница не перезагружается.
  // Правая колонка становится компактной, проверяем каждую вкладку отдельно
  await openTab(page, 'Доска');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await expect.poll(() => boardSizes(page)).toEqual({ row: 48, ghostRow: 48, ghostFont: 24 });
  await expect.poll(() => boardProblems(page)).toEqual([]);

  await openTab(page, 'Редактор');
  await expect.poll(() => editorSizes(page)).toEqual({ editor: 26, gutter: 26 });

  await openTab(page, 'Результат');
  await expect(page.getByTestId('result-count')).toHaveText('11 строк');
  await expect.poll(() => gridProblems(page)).toEqual([]);
});

// Панели шелла при живой смене (P8.100): минимум поля редактора 9rem пересчитывается от нового
// корня. 18px ниже порога компактного режима, поэтому панель редактора ещё на месте
const editorPanel = (page: Page) =>
  page.locator('[data-panel]#editor').evaluate((el) => el.getBoundingClientRect().height);

test('живая смена шрифта 18px: поле редактора не меньше 9rem', async ({ page }) => {
  await openLesson(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '18px';
  });
  await expect.poll(() => editorPanel(page)).toBeGreaterThanOrEqual(9 * 18 - 1);
  await expect(page.getByTestId('workspace-tabs')).toHaveCount(0);
});

// html { font-size } не двигает em в media query: порог 80em считается от начального шрифта.
// Поэтому узкий режим дополнительно проверяет ширину окна от корневого шрифта (P8.118)
test('style корня 32px: сайдбар уходит в Sheet по кнопке «Уроки»', async ({ page }) => {
  await openLesson(page);
  await expect(page.getByRole('navigation', { name: 'Уроки', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await expect(page.getByRole('button', { name: 'Уроки', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Уроки', exact: true })).toHaveCount(0);
});

// Настройка шрифта браузера (CDP): от неё зависят и rem, и em медиазапроса. Как после перезагрузки:
// сайдбар уходит в Sheet, правая колонка становится компактной, редактор доступен во вкладке
test('настройка шрифта 32px: компактные вкладки и сайдбар в Sheet', async ({ page }) => {
  await openLesson(page);
  await expect(page.getByRole('navigation', { name: 'Уроки', exact: true })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  await expect.poll(() => rootFont(page)).toBe(32);
  await expect(page.getByTestId('workspace-tabs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Уроки', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Уроки', exact: true })).toHaveCount(0);
  await openTab(page, 'Редактор');
  expect(await editorSizes(page)).toEqual({ editor: 26, gutter: 26 });
});

// 200% зума даёт окно 720x450: четыре панели не помещаются, компактные вкладки оставляют доску
test('200% зума 720x450: компактные вкладки и доска в кадре', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await openLesson(page);
  await expect(page.getByTestId('workspace-tabs')).toBeVisible();
  const board = await page.getByTestId('board-area').boundingBox();
  const table = await page.getByTestId(BOOK).boundingBox();
  if (!board || !table) throw new Error('нет доски или таблицы');
  expect(table.x).toBeGreaterThanOrEqual(board.x - 2);
  expect(table.y).toBeGreaterThanOrEqual(board.y - 2);
  expect(table.x + table.width).toBeLessThanOrEqual(board.x + board.width + 2);
  expect(table.y + table.height).toBeLessThanOrEqual(board.y + board.height + 2);
  await expect(page.getByTestId('pg-version')).toHaveCount(0);
  await expect(page.locator('.react-flow__controls')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Вписать доску в экран' })).toBeVisible();
});
