import { expect, test } from '@playwright/test';

test('урок о перечислениях: порядок, ошибка и добавление значения', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/enum');
  await expect(page.getByRole('heading', { name: 'enum', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'enum_range(null::order_status)', rows: [['{new,paid,shipped,cancelled}']], count: '1 строка' },
    {
      sql: 'count(*) as n from orders group by status',
      rows: [
        ['new', '2'],
        ['paid', '4'],
        ['shipped', '1'],
        ['cancelled', '1'],
      ],
      count: '4 строки',
    },
    {
      sql: 'select status, order_id from orders order by status',
      rows: [
        ['new', '5'],
        ['new', '8'],
        ['paid', '1'],
      ],
      count: '3 строки',
    },
    {
      sql: "status > 'paid'",
      rows: [
        ['new', 'false'],
        ['paid', 'false'],
        ['shipped', 'true'],
        ['cancelled', 'true'],
      ],
      count: '4 строки',
    },
    { sql: 'order by status::text', rows: [['cancelled']], count: '1 строка' },
    { sql: "values (6, 'payed'", error: '22P02' },
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
    for (const [row, cells] of (example.rows ?? []).entries())
      for (const [column, value] of cells.entries())
        await expect(page.getByTestId(`cell-${row}-${column}`)).toHaveText(value);
    if (example.rows) {
      const ghost = page.getByTestId('ghost-table').filter({ hasText: example.rows[0][0] }).last();
      await expect(ghost).toBeVisible();
      await expect(ghost).toBeInViewport({ timeout: 15_000 });
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  const apply = page.getByTestId('sql-block').filter({ hasText: 'alter type order_status add value' });
  await apply.getByRole('button', { name: 'Применить' }).click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
  await expect(page.getByTestId('ghost-table')).toHaveCount(0, { timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath('example-7.png') });
  await page
    .getByTestId('sql-block')
    .filter({ hasText: 'enum_range(null::order_status)' })
    .getByRole('button', { name: 'На доску' })
    .click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('{new,paid,shipped,returned,cancelled}', {
    timeout: 15_000,
  });
  await page.screenshot({ path: testInfo.outputPath('example-8.png') });
});
