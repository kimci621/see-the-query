import { expect, type Page, test } from '@playwright/test';

// Запуск: pnpm e2e:perf (в CI не гоняется: headless-браузер не даёт честных fps; идёт на прод-сборке)
// 30 таблиц на доске: 2 таблицы урока select-basics + 27 заполнителей + perf_big на 200 строк
const FILLER = Array.from(
  { length: 27 },
  (_, i) => `  create table perf_t${i + 1} (id int, name text);`,
).join('\n');
const BIG =
  "  create table perf_big as select i as id, 'строка ' || i as name from generate_series(1, 200) i;";
const DDL = `do $$\nbegin\n${FILLER}\n${BIG}\nend $$;`;

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

test('@perf 30 таблиц, 200 строк, pan/zoom во время анимации: ≥55 fps при CPU ×4', async ({ page }) => {
  // медленная скорость: повтор сцены кнопкой «Играть» идёт на 0.5x и не кончается до конца замера
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 0.5, autoplay: true, followCamera: false }, version: 0 }),
    );
  });

  await page.goto('/l/select-basics');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
  await typeQuery(page, DDL);
  await page.keyboard.press('ControlOrMeta+Enter'); // «Применить»
  // созданные таблицы встают правее таблиц урока; перед замером видна вся доска
  await expect(page.getByText('Записано в базу', { exact: true })).toBeVisible({ timeout: 10_000 });

  // React Flow рисует только ноды в кадре (onlyRenderVisibleElements): отдаляем доску до минимума 0.25,
  // чтобы в кадре было как можно больше таблиц
  const box = await page.getByTestId('board-area').boundingBox();
  if (!box) throw new Error('доска не найдена');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(50);
  }
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', /scale\(0\.25\)/);
  await expect(page.getByTestId('table-node-public.perf_big')).toBeAttached({ timeout: 10_000 });
  const rendered = await page.locator('[data-testid^="table-node-"]').count();

  // первый кадр сцены: на стадии FROM 200 призраков (бюджет из спеки 9:
  // 250 мс дебаунс + 300 мс на кадр). Без замедления CPU: бюджет про реальное железо
  await typeQuery(page, 'select id, name from perf_big;');
  const t0 = Date.now();
  await expect(page.getByTestId('ghost-row')).toHaveCount(200, { timeout: 5_000 });
  const firstFrameMs = Date.now() - t0;

  // после правки сцена идёт не медленнее 2x: дожидаемся конца и повторяем её на 0.5x
  const toggle = page.getByTestId('player-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Играть', { timeout: 15_000 });

  // факт Ф0: замедление CPU ×4, спайк доски проходил с ним
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Пауза');

  // считаем кадры 2 секунды через requestAnimationFrame, пока крутим колесо над доской
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (t: number) => {
          frames += 1;
          if (t - start < 2000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (t - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
    await page.waitForTimeout(80);
  }
  const measuredFps = await fps;
  // анимация шла весь замер
  await expect(toggle).toHaveAttribute('aria-label', 'Пауза');
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log(
    `нод в кадре: ${rendered} из 30, первый кадр: ${firstFrameMs} мс, fps (CPU ×4): ${measuredFps.toFixed(1)}`,
  );
  expect(measuredFps).toBeGreaterThanOrEqual(55);
  expect(firstFrameMs).toBeLessThanOrEqual(550);
});
