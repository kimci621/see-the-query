import { expect, type Page, test } from '@playwright/test';

// Крупный шрифт браузера (P8.14, WCAG 1.4.4): редактор, сетка результата, ноды доски и призраки
// растут вместе с корневым размером шрифта и ничего не наезжает. Проверки в px страницы

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
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(BOOK)).toBeVisible({ timeout: 20_000 });
}

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

const rootFont = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));

// Нарушения раскладки: пересечения соседних строк, текст обрезан по вертикали,
// заглушка «+N колонки» вылезает за таблицу или её текст за заглушку. Пустой список - всё в порядке
async function layoutProblems(page: Page): Promise<string[]> {
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

    const grid = Array.from(document.querySelectorAll('[role="row"][data-testid^="row-"]'));
    if (grid.length === 0) problems.push('результат: нет строк');
    overlap('результат', grid);
    clipped(
      'результат',
      grid.flatMap((r) => Array.from(r.children)),
    );
    return problems;
  }, BOOK);
}

// Размеры, которые должны идти от корня: шрифт редактора, высота строки ноды и призрака
async function sizes(page: Page) {
  return page.evaluate((book) => {
    const px = (el: Element | null) => (el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN);
    const row = document.querySelector(`[data-testid="${book}"] [data-row]`) as HTMLElement | null;
    const ghostRow = document.querySelector('[data-testid="ghost-row"]') as HTMLElement | null;
    const ghostCell = ghostRow?.querySelector('.vs-cell') ?? null;
    return {
      editor: px(document.querySelector('.cm-content')),
      gutter: px(document.querySelector('.cm-gutterElement')),
      row: row?.offsetHeight ?? Number.NaN,
      ghostRow: ghostRow?.offsetHeight ?? Number.NaN,
      ghostFont: px(ghostCell),
    };
  }, BOOK);
}

// Ждём конца сцены: результат готов, автоплей дошёл до последнего шага
async function sceneDone(page: Page) {
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 10_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 10_000,
  });
}

test('200% шрифта браузера: редактор, сетка, доска и призрак растут и не наезжают', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
  await openLesson(page);
  expect(await rootFont(page)).toBe(32);
  // Стоим на шаге FROM: призрак целиком, со свёрнутыми колонками book
  await typeQuery(page, 'select title from book');
  await sceneDone(page);
  await page.getByTestId('stage-chip').first().click();
  await expect(page.getByTestId('ghost-folded')).toBeVisible();

  const s = await sizes(page);
  expect(s.editor).toBe(26); // 0.8125rem
  expect(s.gutter).toBe(26);
  expect(s.row).toBe(48); // 1.5rem
  expect(s.ghostRow).toBe(48);
  expect(s.ghostFont).toBe(24); // 0.75rem
  expect(await layoutProblems(page)).toEqual([]);
});

test('живая смена шрифта: доска, призрак и сетка пересчитываются без перезагрузки', async ({ page }) => {
  await openLesson(page);
  await typeQuery(page, 'select title from book');
  await sceneDone(page);
  await page.getByTestId('stage-chip').first().click();
  await expect(page.getByTestId('ghost-folded')).toBeVisible();
  expect(await sizes(page)).toEqual({ editor: 13, gutter: 13, row: 24, ghostRow: 24, ghostFont: 12 });

  // Пользователь меняет размер шрифта в браузере: корень 16px → 32px, страница не перезагружается
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await expect
    .poll(() => sizes(page))
    .toEqual({ editor: 26, gutter: 26, row: 48, ghostRow: 48, ghostFont: 24 });
  await expect.poll(() => layoutProblems(page)).toEqual([]);
});
