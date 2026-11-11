import { expect, test } from '@playwright/test';

test('урок о строках: примеры дают описанные значения', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/strings');
  await expect(page.getByRole('heading', { name: 'Строки', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: "'ab'::char(5)", cells: ['ab|', '2'] },
    { sql: "'Тихий' || ' ' || 'Дон'", cells: ['Тихий Дон'] },
    { sql: "initcap('hello world')", cells: ['Hello World', '=========='] },
    { sql: "upper('тихий дон')", cells: ['ТИХИЙ ДОН', 'python', 'привет'] },
    { sql: "title ilike '%python%'", cells: ['Python. К вершинам мастерства', '2400.00'], count: '3 строки' },
    { sql: "left('Привет', 3)", cells: ['При', 'ет', '8'] },
    { sql: "length('Привет')", cells: ['6', '12'] },
    { sql: "format('%s (%s ₽)'", cells: ['Тихий Дон (890.00 ₽)'] },
    { sql: "select ' a@b.ru '", cells: ['false', 'true'] },
  ];
  for (const [index, example] of examples.entries()) {
    const block = page.getByTestId('sql-block').filter({ hasText: example.sql });
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    await block.getByRole('button', { name: 'На доску' }).click();
    await expect(page.locator('.cm-content')).toContainText(example.sql);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const modulePath = '/src/stores/scene.ts';
            const store = await import(modulePath);
            return store.useSceneStore.getState().trace?.sql;
          }),
        { timeout: 15_000 },
      )
      .toBe(sql);
    if (example.count) await expect(page.getByTestId('result-count')).toHaveText(example.count);
    for (const [column, value] of example.cells.entries())
      await expect(page.getByTestId(`cell-0-${column}`)).toHaveText(value);
    const ghost = page.getByTestId('ghost-table').filter({ hasText: example.cells[0] }).last();
    await expect(ghost).toBeVisible();
    await expect(ghost).toBeInViewport({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  await expect(page.getByRole('region', { name: 'Шпаргалка' })).toBeVisible();
});
