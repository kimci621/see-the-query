import { expect, test } from '@playwright/test';

test('урок о датах: примеры и часовые пояса', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/dates-time');
  await expect(page.getByRole('heading', { name: 'Дата и время', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: "published_at + interval '90 days'", cells: ['1926-01-01', '1926-04-01'] },
    { sql: "select interval '1 day 2 hours'", cells: ['1 day 02:00:00'] },
    { sql: 'extract(year from published_at)', cells: ['1', '1940'], count: '2 строки' },
    { sql: "date_trunc('month', published_at)", cells: ['2022-03-01'] },
    { sql: "select age(timestamp '2026-01-01'", cells: ['35 years 7 mons 17 days'] },
    {
      sql: "created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI'",
      cells: ['7', '2024-05-01 00:10', '2024-04-30 21:10'],
    },
    { sql: "created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD'", cells: ['2024-05-01'] },
    { sql: 'select order_id from orders\nwhere created_at >=', cells: ['7'] },
    { sql: "'2024-02-31'::date", error: '22008' },
    { sql: "timestamp '2024-05-01 00:10+03'", cells: ['2024-05-01 00:10', '2024-04-30 21:10'] },
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
    if (example.error) await expect(page.getByTestId('pg-error')).toContainText(example.error);
    if (example.count) await expect(page.getByTestId('result-count')).toHaveText(example.count);
    for (const [column, value] of (example.cells ?? []).entries())
      await expect(page.getByTestId(`cell-0-${column}`)).toHaveText(value);
    if (!example.error) {
      const ghost = page.getByTestId('ghost-table').filter({ hasText: example.cells?.[0] }).last();
      await expect(ghost).toBeInViewport({ timeout: 15_000 });
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  await expect(page.getByRole('region', { name: 'Шпаргалка' })).toBeVisible();
});
