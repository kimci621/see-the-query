import { expect, test } from '@playwright/test';

test('навигация по урокам, поиск, режим фокуса', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/l\/how-to-use$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Как пользоваться доской' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Соседние уроки' }).getByRole('link').click();
  await expect(page).toHaveURL(/\/l\/select-basics$/);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Урок, тема, ключевое слово SQL...').fill('доска');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/l\/how-to-use$/);

  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByText(/Заглушка урока/)).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByText(/Заглушка урока/)).toBeVisible();
});

test('раскладка и тема переживают перезагрузку', async ({ page }) => {
  await page.goto('/l/how-to-use');
  await page.getByRole('button', { name: 'Тема оформления' }).click();
  await page.getByRole('menuitemradio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vs-settings') ?? '{}'));
  expect(saved.state.mainLayout).toHaveLength(3);
});

test('шрифт Geist содержит кириллицу', async ({ page }) => {
  await page.goto('/l/how-to-use');
  // Сабсеты грузятся лениво: просим браузер загрузить кириллицу явно, иначе check() даст false
  await page.evaluate(() =>
    Promise.all([
      document.fonts.load('16px "Geist Variable"', 'Привет'),
      document.fonts.load('16px "Geist Mono Variable"', 'Привет'),
    ]),
  );
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(
    () =>
      document.fonts.check('16px "Geist Variable"', 'Привет') &&
      document.fonts.check('16px "Geist Mono Variable"', 'Привет'),
  );
  expect(ok).toBe(true);
});

test('SQL-блок урока подсвечен и несёт мету', async ({ page }) => {
  await page.goto('/l/how-to-use');
  const pre = page.locator('pre[data-lang="sql"]').first();
  await expect(pre).toHaveAttribute('data-meta', 'run expect=rows:11');
  await expect(pre).toHaveClass(/shiki/);
});

test('Tab с доски фокусирует ноду таблицы с подписью', async ({ page }) => {
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('rf__node-public.book')).toBeVisible({ timeout: 20_000 });
  // клик по пустому месту доски, затем Tab: фокус попадает на первую по DOM ноду таблицы
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.click(box.x + 4, box.y + 4);
  await page.keyboard.press('Tab');
  const focused = page.locator('.react-flow__node-table:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute(
    'aria-label',
    /^Таблица public\.\w+, \d+ (строк|строки|строка), колонки: \w+/,
  );
  // следующий Tab переходит ко второй таблице
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('rf__node-public.book')).toBeFocused();
});

test('поиск из Sheet на узком экране: фокус в поле поиска', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/l/how-to-use');
  await page.getByRole('button', { name: 'Уроки' }).click();
  await page.getByRole('dialog', { name: 'Уроки' }).getByRole('button', { name: /Поиск/ }).click();
  await expect(page.getByPlaceholder('Урок, тема, ключевое слово SQL...')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Уроки' })).toBeHidden();
});

test.describe('тулбар не обрезается на узком экране и при 200% текста', () => {
  const panelRight = async (page: import('@playwright/test').Page) => {
    const panel = await page.getByRole('region', { name: 'Редактор' }).boundingBox();
    const apply = await page.getByTestId('apply-button').boundingBox();
    if (!panel || !apply) throw new Error('нет панели редактора или кнопки');
    return { panel: panel.x + panel.width, apply: apply.x + apply.width };
  };

  test('768x1024', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/l/how-to-use');
    await expect(page.getByTestId('apply-button')).toBeVisible();
    const { panel, apply } = await panelRight(page);
    expect(apply).toBeLessThanOrEqual(panel);
    // сайдбар ушёл в Sheet
    await page.getByRole('button', { name: 'Уроки' }).click();
    await expect(page.getByRole('dialog', { name: 'Уроки' })).toBeVisible();
  });

  test('1280x800 при html font-size 200%', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/l/how-to-use');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expect(page.getByTestId('apply-button')).toBeVisible();
    const { panel, apply } = await panelRight(page);
    expect(apply).toBeLessThanOrEqual(panel);
  });
});

test('200% текста на 1024x768: поле редактора, «Применить» и заголовок теории на месте', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  // крупный текст браузера: корневой размер шрифта 200% ещё до старта приложения
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await page.goto('/l/select-basics');
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible({ timeout: 20_000 });

  // редактор сжат до минимума: доска забирает всё, что может
  await page.getByRole('separator', { name: 'Высота доски' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('separator', { name: 'Граница редактора и результата' }).focus();
  await page.keyboard.press('Home');

  // в поле редактора помещаются хотя бы 2 строки
  const lineHeight = await content.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
  const scroller = await page.locator('.cm-scroller').boundingBox();
  expect(scroller?.height ?? 0).toBeGreaterThanOrEqual(lineHeight * 2);

  // CodeMirror занимает всю панель: рамка фокуса обводит поле, а не строку
  const editorBox = await page.locator('.cm-editor').boundingBox();
  const slotBox = await page.locator('.editor-pane > div').first().boundingBox();
  expect(Math.abs((editorBox?.height ?? 0) - (slotBox?.height ?? 1))).toBeLessThan(2);

  // «Применить» целиком внутри региона «Редактор»
  const region = await page.getByRole('region', { name: 'Редактор' }).boundingBox();
  const apply = await page.getByTestId('apply-button').boundingBox();
  expect(region).not.toBeNull();
  expect(apply).not.toBeNull();
  if (region && apply) {
    expect(apply.x).toBeGreaterThanOrEqual(region.x);
    expect(apply.y).toBeGreaterThanOrEqual(region.y);
    expect(apply.x + apply.width).toBeLessThanOrEqual(region.x + region.width + 0.5);
    expect(apply.y + apply.height).toBeLessThanOrEqual(region.y + region.height + 0.5);
  }

  // заголовок урока переносится и не шире своей колонки
  const h1 = page.getByRole('heading', { level: 1 });
  const overflow = await h1.evaluate((el) => {
    const panel = el.closest('[data-slot="resizable-panel"]');
    return {
      h1: el.getBoundingClientRect().right,
      panel: panel?.getBoundingClientRect().right ?? 0,
      scroll: el.scrollWidth - el.clientWidth,
    };
  });
  expect(overflow.scroll).toBeLessThanOrEqual(0);
  expect(overflow.h1).toBeLessThanOrEqual(overflow.panel);

  // сайдбар растёт со шрифтом: «Поиск» не обрезан, от названия урока видно больше номера
  const search = page.getByRole('button', { name: /Поиск/ });
  expect(await search.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const title = await page
    .getByRole('navigation', { name: 'Уроки', exact: true })
    .getByRole('link', { name: /SELECT/ })
    .locator('span.truncate')
    .evaluate((el) => ({ width: el.clientWidth, em: Number.parseFloat(getComputedStyle(el).fontSize) }));
  expect(title.width).toBeGreaterThanOrEqual(title.em * 4);
});

test('reduced motion: Dialog и Sheet открываются без анимации', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animation = (selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).animationName);

  await page.goto('/l/select-basics');
  await expect(page.getByTestId('reset-button')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('reset-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await animation('[data-slot="dialog-content"]')).toBe('none');
  expect(await animation('[data-slot="dialog-overlay"]')).toBe('none');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: 'Уроки' }).click();
  await expect(page.getByRole('dialog', { name: 'Уроки' })).toBeVisible();
  expect(await animation('[data-slot="sheet-content"]')).toBe('none');
  expect(await animation('[data-slot="sheet-overlay"]')).toBe('none');
});
