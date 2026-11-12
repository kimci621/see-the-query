import { expect, test } from '@playwright/test';

test('урок о JSONB: операторы и раскрытие объектов и массивов', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/jsonb');
  await expect(page.getByRole('heading', { name: 'JSON и JSONB', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    {
      sql: 'select title, meta from book where book_id = 1',
      count: '1 строка',
      cells: [[0, 0, 'Тихий Дон']],
      contains: ['hardcover', 'ru'],
    },
    {
      sql: "meta->>'format' as format",
      count: '2 строки',
      cells: [
        [0, 0, '1'],
        [0, 1, 'hardcover'],
        [1, 0, '2'],
        [1, 1, 'paperback'],
      ],
    },
    {
      sql: "meta->'edition' as edition_jsonb",
      count: '1 строка',
      cells: [
        [0, 0, '2'],
        [0, 1, '2'],
        [0, 2, 'jsonb'],
        [0, 3, 'text'],
      ],
    },
    {
      sql: 'meta @> \'{"lang": "ru"}\'',
      count: '7 строк',
      cells: [
        [0, 0, '1'],
        [6, 0, '10'],
      ],
    },
    {
      sql: 'where c.customer_id = 1',
      count: '2 строки',
      cells: [
        [0, 0, '1'],
        [0, 1, 'lang'],
        [1, 1, 'notify'],
      ],
      expand: 'JSONB_EACH',
      alias: 's',
      children: 7,
    },
    {
      sql: 'where c.customer_id = 2',
      count: '1 строка',
      cells: [
        [0, 0, '2'],
        [0, 1, 'notify'],
      ],
      expand: 'JSONB_EACH',
      alias: 's',
      children: 7,
    },
    {
      sql: 'jsonb_array_elements(j.doc)',
      count: '3 строки',
      cells: [
        [0, 0, '1'],
        [1, 0, '2'],
        [2, 0, '3'],
      ],
      expand: 'JSONB_ARRAY_ELEMENTS',
      alias: 'e',
      children: 3,
    },
    { sql: "jsonb_build_object('title'", count: '1 строка', contains: ['Тихий Дон', 'true'] },
    {
      sql: "'{\"a\": null}'::jsonb ? 'a'",
      count: '1 строка',
      cells: [
        [0, 0, 'true'],
        [0, 1, 'NULL'],
        [0, 2, 'false'],
      ],
    },
  ] as const;
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
    if ('cells' in example)
      for (const [row, column, value] of example.cells)
        await expect(page.getByTestId(`cell-${row}-${column}`)).toHaveText(value);
    if ('contains' in example)
      for (const value of example.contains)
        await expect(page.getByTestId('results-panel')).toContainText(value);
    if ('expand' in example) {
      await page.getByTestId('stage-chip').filter({ hasText: example.expand }).click();
      await page.getByTestId('player-prev').click();
      const child = page.locator(`[data-table-id="t:${example.alias}"]`);
      await expect(child.getByTestId('ghost-row')).toHaveCount(example.children);
      await expect(child).toBeInViewport({ timeout: 15_000 });
      await expect(page.locator('.vs-bracket')).not.toHaveCount(0);
      if (example.expand === 'JSONB_ARRAY_ELEMENTS') {
        await expect(page.getByTestId('overlay')).not.toContainText('__vs_');
        await expect(page.getByTestId('stage-chip').first()).toHaveText('FROM j');
        await expect(page.locator('[data-table-id="t:j"]')).toContainText('[1,2,3]');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
