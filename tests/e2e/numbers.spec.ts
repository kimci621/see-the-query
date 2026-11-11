import { expect, test } from '@playwright/test';

test('урок о числах: примеры и ошибки соответствуют тексту', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/numbers');
  await expect(page.getByRole('heading', { name: 'Числа', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'select 7 / 2 as int_div', cells: ['3', '3.5000000000000000'] },
    { sql: 'pages::numeric / 100', cells: ['64', '0.64000000000000000000'] },
    { sql: 'sum(price) as total', cells: ['11380.00', '1138.0000000000000000'] },
    { sql: 'round(2.5) as r25', cells: ['3', '4'] },
    { sql: '0.1::float8 + 0.2::float8', cells: ['0.30000000000000004', '0.3'] },
    { sql: 'price::float8 as approx_price', cells: ['890'] },
    { sql: '2147483647 + 1', error: '22003' },
    { sql: 'sum(qty * price) as revenue', cells: ['1730.00'] },
    { sql: '13 / 10 * 10', cells: ['10', '13.0000000000000000'] },
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
    if (example.error) await expect(page.getByTestId('pg-error')).toContainText(example.error);
    for (const [column, value] of (example.cells ?? []).entries())
      await expect(page.getByTestId(`cell-0-${column}`)).toHaveText(value);
    if (example.cells) {
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const modulePath = '/src/stores/scene.ts';
              const store = await import(modulePath);
              const phase = store.useSceneStore.getState().playback?.phases.at(-1);
              return phase?.frame.tables.at(-1)?.rows[0]?.values.map(String);
            }),
          { timeout: 15_000 },
        )
        .toEqual(example.cells);
      const ghost = page.getByTestId('ghost-table').filter({ hasText: example.cells[0] }).last();
      await expect(ghost).toBeVisible();
      await expect(ghost).toBeInViewport({ timeout: 15_000 });
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  await expect(page.getByRole('region', { name: 'Шпаргалка' })).toBeVisible();
});
