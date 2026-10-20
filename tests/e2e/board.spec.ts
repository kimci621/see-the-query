import { expect, type Page, test } from '@playwright/test';

// Камера сцены летит за призраком в рабочую зону справа от таблиц и уводит book из кадра.
// Тесты рефита доски с ней гоняются: проверка ловит book в кадре, только если успела до полёта
// (флейк на холодном старте, P8.90). Выключаем «Камера следит»: движется только камера доски; камеру сцены проверяет overlay.spec
async function withoutSceneCamera(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: true, followCamera: false }, version: 0 }),
    );
  });
}

async function openBookstore(page: Page) {
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
}

test('bookstore разложен без наложений, FK и рамка схемы на месте', async ({ page }) => {
  await openBookstore(page);
  // author на старте вне кадра, а React Flow рисует только ноды в кадре: вписываем всю доску
  await page.getByTestId('table-node-public.book').hover();
  await page.keyboard.press('ControlOrMeta+0');
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
  await withoutSceneCamera(page);
  await openBookstore(page);
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('hidden-columns')).toHaveText('+4 колонки');
  await expect(book.locator('[data-column="tags"]')).toHaveCount(0);
  // свёрнутая ширина: 5 колонок по 132 и заглушка 96
  const zoom = await zoomOf(page);
  const collapsed = await book.boundingBox();
  expect(collapsed?.width ?? 0).toBeCloseTo(756 * zoom, 0);
  // author вне стартового кадра не рисуется: ⌘0 вписывает доску, нода появляется
  await book.hover();
  await page.keyboard.press('ControlOrMeta+0');
  const author = await flowTransform(page, 'public.author');

  await setEditorText(page, 'select tags from book');
  await expect(book.locator('[data-column="tags"]')).toBeVisible();
  await expect(book.getByTestId('hidden-columns')).toHaveText('+4 колонки');

  await setEditorText(page, 'select * from book');
  await expect(book.getByTestId('hidden-columns')).toHaveCount(0);
  await expect(book.locator('[data-column]')).toHaveCount(9);
  await expect(book.locator('[data-column="meta"]')).toBeVisible();
  await book.hover();
  await page.keyboard.press('ControlOrMeta+0');
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

// how-to-use стартует со свёрнутой book (P8.13), select * разворачивает её до 1188 единиц: целиком в кадре
test('how-to-use: свёрнутая book на старте, после select * в кадре, ⌘0 показывает шапки book и author', async ({
  page,
}) => {
  await withoutSceneCamera(page);
  await page.goto('/l/how-to-use');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('hidden-columns')).toHaveText('+4 колонки', { timeout: 20_000 });
  await setEditorText(page, 'select * from book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible();
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
  // сцена доиграла: её камера больше не двигается
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });

  // развёрнутая book с author на 0.6 по высоте не влезает: кадр держит левый верхний угол, шапки видны.
  // ⌘0 доска ловит только под курсором: наводим на центр доски
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(() => headersOutside(page, ['public.book', 'public.author'])).toEqual([]);
});

// Чьи шапки (имя таблицы) не целиком на доске
async function headersOutside(page: Page, ids: string[]): Promise<string[]> {
  const board = await page.locator('.react-flow').boundingBox();
  if (!board) throw new Error('нет доски');
  const out: string[] = [];
  for (const id of ids) {
    const r = await page.getByTestId(`table-node-${id}`).locator('.vs-table-name').boundingBox();
    const inside =
      r &&
      r.x >= board.x &&
      r.x + r.width <= board.x + board.width &&
      r.y >= board.y &&
      r.y + r.height <= board.y + board.height;
    if (!inside) out.push(id);
  }
  return out;
}

// P8.60: до первого замера обёртка ноды не должна держать ширину initialWidth (свёрнутая book).
// Иначе после замера развёрнутая book растёт посреди обработки ResizeObserver и браузер пишет «loop completed»
test('table-anatomy: старт доски без «ResizeObserver loop»', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { roErrors: string[] }).roErrors = seen;
    window.addEventListener('error', (e) => {
      if (String(e.message).includes('ResizeObserver')) seen.push(e.message);
    });
  });
  await page.goto('/l/table-anatomy');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
  expect(await page.evaluate(() => (window as unknown as { roErrors: string[] }).roErrors)).toEqual([]);
});

// Первый трейс нового урока сворачивает book: рефит идёт в стартовый кадр нового урока, а не во всю доску
test('переход table-anatomy → select-basics заканчивается стартовым кадром select-basics', async ({
  page,
}) => {
  await page.goto('/l/table-anatomy');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Урок, тема, ключевое слово SQL...').fill('алиас');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/l\/select-basics$/);
  await expect(book.getByTestId('hidden-columns')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(0.85);
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
});

// Колесо над доской: кадр ученика сохраняется в урок. Колесо может прервать рефит по развороту
// на полпути, и промежуточный кадр тоже сохраняется, поэтому ждём кадр после колеса
async function saveCamera(page: Page, lessonId: string): Promise<string> {
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('нет доски');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  const savedZoom = (id: string) =>
    page.evaluate(
      (id) =>
        (JSON.parse(localStorage.getItem('vs-lessons') ?? '{}').state?.byId?.[id]?.viewport?.zoom as
          | number
          | undefined) ?? null,
      id,
    );
  await expect
    .poll(async () => {
      const saved = await savedZoom(lessonId);
      return saved !== null && Math.abs(saved - (await zoomOf(page))) < 1e-3;
    })
    .toBe(true);
  return (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
}

// После первого трейса (результат на месте) камера стоит: рефит начался бы в пределах кадра-двух
async function cameraStays(page: Page, style: string) {
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 20_000 });
  const viewport = page.locator('.react-flow__viewport');
  for (let i = 0; i < 6; i++) {
    await expect(viewport).toHaveAttribute('style', style, { timeout: 0 });
    await page.waitForTimeout(100);
  }
}

// Сохранённая камера важнее стартового кадра и рефита по первому трейсу (разворот book)
test('table-anatomy: сохранённая камера переживает перезагрузку и разворот book', async ({ page }) => {
  await page.goto('/l/table-anatomy');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  const zoomed = await saveCamera(page, 'table-anatomy');

  await page.reload();
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await cameraStays(page, zoomed);
});

// Камера ученика важнее только старта урока: следующий разворот снова перевписывает кадр (13c)
test('сохранённая камера не мешает рефиту после старта: select * вписывает book', async ({ page }) => {
  await withoutSceneCamera(page);
  await openBookstore(page);
  const zoomed = await saveCamera(page, 'select-basics');

  await page.reload();
  const book = page.getByTestId('table-node-public.book');
  await expect(book).toBeVisible({ timeout: 20_000 });
  await cameraStays(page, zoomed);

  await setEditorText(page, 'select * from book');
  await expect(book.getByTestId('hidden-columns')).toHaveCount(0);
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
});

// Разворот свёртки меняет ширину ноды: камера перевписывает кадр
test('select * разворачивает book, и она целиком в кадре', async ({ page }) => {
  await withoutSceneCamera(page);
  await openBookstore(page);
  await setEditorText(page, 'select * from book');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.getByTestId('hidden-columns')).toHaveCount(0);
  await expect
    .poll(async () => (await outsideBoard(page, ['public.book'])).includes('public.book'))
    .toBe(false);
  // и после сцены: без «Камера следит» кадр доски никто не перебивает
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
  expect(await outsideBoard(page, ['public.book'])).not.toContain('public.book');
});

// Доска следует за набором (P8.12): каретка в конце текста, как при обычном наборе.
// Конец имени во FROM ведёт фокус сразу, хвост WHERE - по завершении трассы
for (const sql of ['select name from author', 'select name from author where author_id > 2']) {
  test(`набор «${sql}»: author в фокусе и целиком в кадре`, async ({ page }) => {
    await openBookstore(page);
    await setEditorText(page, sql);
    const author = page.getByTestId('table-node-public.author');
    await expect(author).toHaveAttribute('data-focused', 'true', { timeout: 5000 });
    // book может уйти из кадра, а ноду вне кадра React Flow не рисует: проверяем, что фокусной book нет
    await expect(page.locator('[data-testid="table-node-public.book"][data-focused]')).toHaveCount(0);
    await expect
      .poll(async () => (await outsideBoard(page, ['public.author'])).includes('public.author'))
      .toBe(false);
  });
}

// «Применить» DDL (P8.59, спека 3.4): камера к созданной или изменённой таблице, после DROP вся доска
test('после «Применить» CREATE, ALTER и DROP TABLE камера показывает, что изменилось', async ({ page }) => {
  await openBookstore(page);
  const apply = async (sql: string) => {
    await setEditorText(page, sql);
    await expect(page.getByTestId('preview-status')).toContainText('Превью', { timeout: 5000 });
    await page.getByTestId('apply-button').click();
  };
  const framed = (ids: string[]) => expect.poll(async () => outsideBoard(page, ids), { timeout: 5000 });

  await apply('create table mine (id int primary key, name text)');
  await expect(page.getByTestId('table-node-public.mine')).toHaveAttribute('data-focused', 'true', {
    timeout: 5000,
  });
  await framed(['public.mine']).not.toContain('public.mine');

  await apply('alter table author add column city text');
  const author = page.getByTestId('table-node-public.author');
  await expect(author.locator('[data-column="city"]')).toBeVisible({ timeout: 5000 });
  await expect(author).toHaveAttribute('data-focused', 'true');
  await framed(['public.author']).not.toContain('public.author');

  await apply('drop table mine');
  await expect(page.getByTestId('table-node-public.mine')).toHaveCount(0, { timeout: 5000 });
  await framed(['public.book', 'public.author']).toEqual([]);
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

// Режим фокуса (спека 3.1): сайдбара и теории нет, доска на всю ширину и не мельче, чем до входа.
// Камера перевписывает таблицы запроса; повтор ⌘\\ возвращает раскладку
test('режим фокуса: доска на всю ширину, зум не меньше, чем до входа', async ({ page }) => {
  await openBookstore(page);
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
  const before = await zoomOf(page);
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeHidden();
  const workspace = await page.locator('[id="workspace"]').boundingBox();
  expect(workspace?.width ?? 0).toBeGreaterThanOrEqual(1440 - 2);
  // рефит анимируется, ждём, пока камера осядет: book в кадре, зум не меньше прежнего
  await expect
    .poll(
      async () =>
        !(await outsideBoard(page, ['public.book'])).includes('public.book') &&
        (await zoomOf(page)) >= before,
    )
    .toBe(true);

  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Уроки', exact: true })).toBeVisible();
});

// Стартовый кадр ставится без полёта (спека 3.4), даже когда select * стартового запроса
// разворачивает book уже после первого кадра. Пишем все трансформы вьюпорта с загрузки страницы
test('table-anatomy: стартовый кадр без полёта', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __transforms: seen });
    const tick = () => {
      const style = document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform;
      if (style && style !== seen.at(-1)) seen.push(style);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/l/table-anatomy');
  const book = page.getByTestId('table-node-public.book');
  await expect(book.locator('[data-column="meta"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 20_000 });
  await page.waitForTimeout(600);
  const transforms = await page.evaluate(
    () => (window as unknown as { __transforms: string[] }).__transforms,
  );
  // исходный вьюпорт, затем кадр; второй мгновенный кадр допустим (замер развёрнутой book), полёта нет
  expect(transforms.length, transforms.join('\n')).toBeLessThanOrEqual(3);
});

// Хром доски (плашка версии Postgres, кнопки зума) не ложится на таблицы стартового кадра
for (const lesson of ['select-basics', 'how-to-use']) {
  test(`${lesson}: плашка и контролы доски не закрывают таблицы на старте`, async ({ page }) => {
    await page.goto(`/l/${lesson}`);
    await expect(page.getByTestId('result-count')).toHaveText('11 строк', { timeout: 20_000 });
    await expect(page.getByTestId('pg-version')).toBeVisible();
    await page.waitForTimeout(600);
    const boxes = async (selector: string) =>
      page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    const chrome = [
      ...(await boxes('[data-testid="pg-version"]')),
      ...(await boxes('.react-flow__controls')),
    ];
    const tables = await boxes('[data-testid^="table-node-"]');
    expect(chrome).toHaveLength(2);
    expect(tables.length).toBeGreaterThan(0);
    for (const c of chrome) {
      for (const t of tables) {
        const overlap = c.left < t.right && t.left < c.right && c.top < t.bottom && t.top < c.bottom;
        expect(overlap, `хром ${JSON.stringify(c)} на таблице ${JSON.stringify(t)}`).toBe(false);
      }
    }
  });
}

// Подсказки доски с клавиатуры (P8.17): нода - одна остановка Tab, по шапкам колонок и «+N колонки» ходят ←/→,
// на фокусе шапки видны ограничения, на заглушке имена свёрнутых колонок. Enter разворачивает таблицу, как select *
test('клавиатура: → с ноды на шапку колонки показывает ограничения, Enter на «+N колонки» разворачивает book', async ({
  page,
}) => {
  await openBookstore(page);
  // Ждём трассу стартового запроса: пришла бы после фокуса на доске, и её сцена увела бы камеру от book (P8.111)
  await expect(page.getByTestId('stage-chip').first()).toBeVisible({ timeout: 10_000 });
  const node = page.locator('.react-flow__node[data-id="public.book"]');
  const hint = page.locator('[data-slot="tooltip-content"][data-state$="open"]');
  await node.focus();
  await page.keyboard.press('ArrowRight');
  await expect(node.locator('[data-column="book_id"]')).toBeFocused();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('PRIMARY KEY');
  await page.keyboard.press('ArrowRight');
  await expect(node.locator('[data-column="title"]')).toBeFocused();
  await expect(hint).toContainText('NOT NULL');
  // стартовый запрос select title, price: видны book_id, title, author_id, category_id, price, дальше заглушка
  await page.keyboard.press('End');
  const stub = node.getByRole('button', { name: '+4 колонки' });
  await expect(stub).toBeFocused();
  await expect(hint).toContainText('pages, published_at, tags, meta');
  // плеер стрелки внутри таблицы не берёт: сцена не появилась
  await expect(page.getByTestId('ghost-table')).toHaveCount(0);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(node).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(node.locator('[data-column]')).toHaveCount(9);
  await expect(node.getByTestId('hidden-columns')).toHaveCount(0);
  await expect(node).toBeFocused();
  // book развернулась целиком в кадре, как после select *
  await expect.poll(() => outsideBoard(page, ['public.book'])).not.toContain('public.book');
});
