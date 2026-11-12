import { expect, test } from '@playwright/test';

test('урок MATERIALIZED VIEW: сохранённый снимок и REFRESH', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/materialized-view');
  await expect(page.getByRole('heading', { name: 'MATERIALIZED VIEW и REFRESH', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'create materialized view expensive_mv', apply: true },
    {
      sql: 'select book_id, title from expensive_mv order by book_id',
      cells: [
        [0, 0, '2'],
        [1, 0, '10'],
        [2, 0, '11'],
      ],
      count: '3 строки',
    },
    { sql: 'select count(*) as n from expensive_mv', cells: [[0, 0, '3']], count: '1 строка' },
    { sql: 'update book set price = 1500', apply: true },
    { sql: 'select count(*) as n from book where price > 1000', cells: [[0, 0, '4']], count: '1 строка' },
    { sql: 'select count(*) as snapshot_count from expensive_mv', cells: [[0, 0, '3']], count: '1 строка' },
    { sql: 'refresh materialized view expensive_mv;', apply: true },
    { sql: 'select count(*) as refreshed_count from expensive_mv', cells: [[0, 0, '4']], count: '1 строка' },
    { sql: 'create index expensive_mv_price_idx', apply: true },
  ] as const;
  for (const [index, example] of examples.entries()) {
    const block = page.getByTestId('sql-block').filter({ hasText: example.sql });
    if ('apply' in example) {
      await block.getByRole('button', { name: 'Применить' }).click();
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
      if ([0, 3, 6].includes(index)) {
        await page.getByRole('button', { name: 'expensive_mv', exact: true }).click();
        const snapshot = page.getByTestId('table-node-public.expensive_mv');
        await expect(snapshot).toHaveAttribute('data-kind', 'matview', { timeout: 15_000 });
        await expect(snapshot).toBeInViewport({ ratio: 0.9, timeout: 15_000 });
        await expect(snapshot.getByText(index === 3 ? '1 различие' : 'Совпадает')).toBeVisible({
          timeout: 15_000,
        });
      }
      if (index === 8)
        await expect
          .poll(
            () =>
              page.evaluate(async () => {
                const modulePath = '/src/stores/board.ts';
                const store = await import(modulePath);
                return store.useBoardStore
                  .getState()
                  .schema?.tables.find(
                    (table: { id: string; indexes: { name: string }[] }) =>
                      table.id === 'public.expensive_mv',
                  )
                  ?.indexes.map((item: { name: string }) => item.name);
              }),
            { timeout: 15_000 },
          )
          .toContain('expensive_mv_price_idx');
    } else {
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
      for (const [row, column, value] of example.cells)
        await expect(page.getByTestId(`cell-${row}-${column}`)).toHaveText(value);
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
