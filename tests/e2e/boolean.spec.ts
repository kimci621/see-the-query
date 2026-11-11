import { expect, test } from '@playwright/test';

test('урок о булевой логике: примеры показывают три значения', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/boolean');
  await expect(page.getByRole('heading', { name: 'boolean', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.customer')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'bonus > 0 as has_bonus', cells: ['Анна Смирнова', 'true'], count: '6 строк' },
    { sql: 'true and null as tan', cells: ['NULL', 'false', 'true', 'NULL'], count: '1 строка' },
    { sql: 'count(*) filter (where bonus > 0)', cells: ['3', '6'], count: '1 строка' },
    { sql: 'bonus between 100 and 200', cells: ['Анна Смирнова'], count: '1 строка' },
    { sql: 'city is distinct from null', cells: ['5'], count: '1 строка' },
    { sql: "coalesce(city, 'не указан')", cells: ['Анна Смирнова', 'Москва'], count: '6 строк' },
    { sql: 'not null::boolean as negated', cells: ['NULL', 'true'], count: '1 строка' },
  ];
  for (const [index, example] of examples.entries()) {
    const block = page.getByTestId('sql-block').filter({ hasText: example.sql });
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    await block.getByRole('button', { name: 'На доску' }).click();
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
    await expect(page.getByTestId('result-count')).toHaveText(example.count);
    for (const [column, value] of example.cells.entries())
      await expect(page.getByTestId(`cell-0-${column}`)).toHaveText(value);
    if (index === 5) await expect(page.getByTestId('cell-2-1')).toHaveText('не указан');
    const ghost = page.getByTestId('ghost-table').filter({ hasText: example.cells[0] }).last();
    await expect(ghost).toBeVisible();
    await expect(ghost).toBeInViewport({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  await expect(page.getByRole('region', { name: 'Шпаргалка' })).toBeVisible();
});
