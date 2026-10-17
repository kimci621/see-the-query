import { expect, type Page, test } from '@playwright/test';

async function openBookstore(page: Page) {
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

test('bookstore разложен без наложений, FK и рамка схемы на месте', async ({ page }) => {
  await openBookstore(page);
  const nodes = page.locator('[data-testid^="table-node-"]');
  await expect(nodes).toHaveCount(2);
  const boxes = await nodes.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-testid'), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  for (const a of boxes) {
    for (const b of boxes) {
      if (a.id === b.id) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} перекрывает ${b.id}`).toBe(false);
    }
  }
  await expect(page.locator('.react-flow__edge-fk')).toHaveCount(1);
  await expect(page.getByTestId('schema-group-public')).toBeVisible();
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('row-count')).toHaveText('11');
  expect(await book.locator('[data-kind="null"]').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('pg-version')).toHaveText(/^PostgreSQL 18\.\d+ в браузере$/);
  await expect(page.getByTestId('board-skeleton')).toHaveCount(0);
});

test('камера урока переживает перезагрузку, ⌘0 вписывает доску', async ({ page }) => {
  await openBookstore(page);
  const viewport = page.locator('.react-flow__viewport');
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').state?.byId?.['select-basics']?.viewport ??
          null,
      ),
    )
    .not.toBeNull();
  const zoomed = await viewport.getAttribute('style');

  await page.reload();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await expect(viewport).toHaveAttribute('style', zoomed ?? '');

  // Сдвиг на 1px нужен: после перезагрузки pointerenter не приходит, а ⌘0 работает только над доской
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoomed);
});

test('далёкий зум: строки скрыты, рёбра остаются на шапках таблиц', async ({ page }) => {
  await openBookstore(page);
  const board = page.getByTestId('board-canvas');
  const box = await board.boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('.vs-rows').first()).toBeVisible();
  for (let i = 0; i < 20 && (await board.getAttribute('data-far')) === null; i++) {
    await page.mouse.wheel(0, 300);
  }
  await expect(board).toHaveAttribute('data-far', 'true');
  await expect(book.locator('.vs-rows').first()).toBeHidden();
  await expect(book.locator('.vs-col-meta').first()).toBeHidden();
  await expect(book.locator('[data-column="title"]')).toBeVisible();

  // Концы ребра лежат в полосе шапки таблицы: handles привязаны к шапке, а не к строкам
  const ends = await page
    .locator('.react-flow__edge-fk path.vs-fk-path')
    .first()
    .evaluate((path) => {
      const p = path as SVGPathElement;
      const m = p.getScreenCTM();
      const len = p.getTotalLength();
      const toScreen = (pt: DOMPoint) => ({
        x: pt.x * (m?.a ?? 1) + (m?.e ?? 0),
        y: pt.y * (m?.d ?? 1) + (m?.f ?? 0),
      });
      return [toScreen(p.getPointAtLength(0)), toScreen(p.getPointAtLength(len))];
    });
  const cards = await page
    .locator('[data-testid^="table-node-"] > header')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (const end of ends) {
    const onHeader = cards.some(
      (r) => end.y >= r.top - 2 && end.y <= r.bottom + 2 && end.x >= r.left - 6 && end.x <= r.right + 6,
    );
    expect(onHeader, `конец ребра ${JSON.stringify(end)} вне шапок ${JSON.stringify(cards)}`).toBe(true);
  }
});

test('режим фокуса: после смены ширины доска вписана целиком', async ({ page }) => {
  await openBookstore(page);
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByText(/Заглушка урока/)).toBeHidden();
  const board = page.getByTestId('board-canvas');
  const inside = async () => {
    const b = await board.boundingBox();
    if (!b) throw new Error('нет доски');
    const boxes = await page
      .locator('[data-testid^="table-node-"]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    return boxes.every(
      (r) =>
        r.left >= b.x - 4 &&
        r.right <= b.x + b.width + 4 &&
        r.top >= b.y - 4 &&
        r.bottom <= b.y + b.height + 4,
    );
  };
  // Рефит анимируется 300 мс, ждём, пока камера осядет
  await expect.poll(inside).toBe(true);
});

async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

const zoomOf = async (page: Page) => {
  const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
  return Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? Number.NaN);
};

// Позиция ноды в координатах доски, от камеры не зависит
const flowTransform = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => (el as HTMLElement).style.transform);

test('широкая book свёрнута, колонки запроса видны, select * разворачивает без сдвига соседей', async ({
  page,
}) => {
  await openBookstore(page);
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('hidden-columns')).toHaveText('+4 колонки');
  await expect(book.locator('[data-column="tags"]')).toHaveCount(0);
  // свёрнутая ширина: 5 колонок по 132 и заглушка 96
  const zoom = await zoomOf(page);
  const collapsed = await book.boundingBox();
  expect(collapsed?.width ?? 0).toBeCloseTo(756 * zoom, 0);
  const author = await flowTransform(page, 'public.author');

  await setEditorText(page, 'select tags from book');
  await expect(book.locator('[data-column="tags"]')).toBeVisible();
  await expect(book.getByTestId('hidden-columns')).toHaveText('+4 колонки');

  await setEditorText(page, 'select * from book');
  await expect(book.getByTestId('hidden-columns')).toHaveCount(0);
  await expect(book.locator('[data-column]')).toHaveCount(9);
  await expect(book.locator('[data-column="meta"]')).toBeVisible();
  expect(await flowTransform(page, 'public.author')).toBe(author);
  await expect(page.locator('.react-flow__node[data-id="public.book"]')).toHaveCSS('width', '1188px');
});

// Что из кадра вылезает за доску: таблицы и подпись рамки схемы (её в кадре держит только отступ fitView)
async function outsideBoard(page: Page, ids: string[]): Promise<string[]> {
  const board = await page.locator('.react-flow').boundingBox();
  if (!board) throw new Error('нет доски');
  const inside = (r: { x: number; y: number; width: number; height: number }) =>
    r.x >= board.x &&
    r.x + r.width <= board.x + board.width &&
    r.y >= board.y &&
    r.y + r.height <= board.y + board.height;
  const out: string[] = [];
  for (const id of ids) {
    const r = await page.getByTestId(`table-node-${id}`).boundingBox();
    if (!r || !inside(r)) out.push(id);
  }
  const label = await page
    .getByTestId('schema-group-public')
    .getByText('public', { exact: true })
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().toJSON();
    });
  if (!inside(label)) out.push('подпись public');
  return out;
}

// Стартовый кадр (спека 3.4): камера на таблицы стартового запроса, текст читается.
// ⌘0 вписывает все таблицы урока: book и author друг под другом, подпись схемы в кадре
test('стартовый кадр на book крупно, ⌘0 вписывает book, author и подпись схемы', async ({ page }) => {
  await openBookstore(page);
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
  const start = await zoomOf(page);
  expect(start).toBeGreaterThanOrEqual(0.85);

  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(() => outsideBoard(page, ['public.book', 'public.author'])).toEqual([]);
  const fitted = await zoomOf(page);
  expect(fitted).toBeLessThan(start);
  expect(fitted).toBeGreaterThanOrEqual(0.6);
});

// how-to-use стартует с select * from book: book развёрнута до 1188 единиц и целиком в кадре
test('how-to-use: развёрнутая book в кадре, ⌘0 добавляет author и подпись схемы', async ({ page }) => {
  await page.goto('/l/how-to-use');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(0.6);

  await book.hover();
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(() => outsideBoard(page, ['public.book', 'public.author'])).toEqual([]);
});

// Первый трейс нового урока сворачивает book: рефит идёт в стартовый кадр нового урока, а не во всю доску
test('переход how-to-use → select-basics заканчивается стартовым кадром select-basics', async ({ page }) => {
  await page.goto('/l/how-to-use');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('navigation', { name: 'Соседние уроки' }).getByRole('link').click();
  await expect(page).toHaveURL(/\/l\/select-basics$/);
  await expect(book.getByTestId('hidden-columns')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(0.85);
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
});

// Сохранённая камера важнее стартового кадра и рефита по развороту book
test('how-to-use: сохранённая камера переживает перезагрузку и разворот book', async ({ page }) => {
  await page.goto('/l/how-to-use');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  const viewport = page.locator('.react-flow__viewport');
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  // Колесо может прервать рефит по развороту на полпути, и промежуточный кадр тоже сохраняется.
  // Ждём, пока в хранилище не ляжет кадр после колеса
  const savedZoom = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').state?.byId?.['how-to-use']?.viewport?.zoom as
          | number
          | undefined) ?? null,
    );
  await expect
    .poll(async () => {
      const saved = await savedZoom();
      return saved !== null && Math.abs(saved - (await zoomOf(page))) < 1e-3;
    })
    .toBe(true);
  const zoomed = await viewport.getAttribute('style');

  await page.reload();
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  // рефит анимируется 400 мс: даём ему шанс случиться, камера должна остаться на месте
  await page.waitForTimeout(800);
  await expect(viewport).toHaveAttribute('style', zoomed ?? '');
});

// Разворот свёртки меняет ширину ноды: камера перевписывает кадр
test('select * разворачивает book, и она целиком в кадре', async ({ page }) => {
  await openBookstore(page);
  await setEditorText(page, 'select * from book');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('hidden-columns')).toHaveCount(0);
  await expect
    .poll(async () => (await outsideBoard(page, ['public.book'])).includes('public.book'))
    .toBe(false);
});

// Ноды ловят указатель (иначе title у колонок, флагов и «+N колонки» не показываются),
// а перетаскивание поверх ноды по-прежнему двигает доску
test('подсказки на нодах доступны мыши, drag по ноде двигает вьюпорт', async ({ page }) => {
  await openBookstore(page);
  const book = page.getByTestId('table-node-public.book');
  const head = book.locator('[data-column="title"]');
  const box = await head.boundingBox();
  if (!box) throw new Error('нет колонки title');
  const hit = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[data-column]')?.getAttribute('data-column') ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe('title');

  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before);
});
