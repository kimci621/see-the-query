import { expect, test } from '@playwright/test';

test('урок о массивах: поиск и раскрытие элементов', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/arrays');
  await expect(page.getByRole('heading', { name: 'Массивы', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    {
      sql: 'select title, tags from book where book_id = 1',
      rows: [['Тихий Дон', '{классика,роман}']],
      count: '1 строка',
    },
    { sql: 'select tags[1] as first_tag', rows: [['классика', '2']], count: '1 строка' },
    { sql: 'array_length(tags, 1) as n', rows: [['1', '2']], count: '11 строк' },
    {
      sql: "tags @> '{python}'",
      rows: [
        ['2', 'Python. К вершинам мастерства'],
        ['10', 'Простой Python'],
        ['11', 'Изучаем Python'],
      ],
      count: '3 строки',
    },
    {
      sql: "'beginner' = any(tags)",
      rows: [
        ['10', 'Простой Python'],
        ['11', 'Изучаем Python'],
      ],
      count: '2 строки',
    },
    {
      sql: 'where b.book_id = 5',
      rows: [
        ['Сказка о рыбаке и рыбке', 'классика'],
        ['Сказка о рыбаке и рыбке', 'сказка'],
        ['Сказка о рыбаке и рыбке', 'детям'],
      ],
      count: '3 строки',
      expand: true,
    },
    {
      sql: "where u.tag = 'python'",
      rows: [
        ['Python. К вершинам мастерства', 'python'],
        ['Простой Python', 'python'],
        ['Изучаем Python', 'python'],
      ],
      count: '3 строки',
      expand: true,
    },
    { sql: 'array_agg(distinct unnest(tags))', error: '0A000' },
    {
      sql: 'select unnest(tags) as tag',
      rows: [['классика'], ['сказка'], ['детям']],
      count: '3 строки',
      finalOnly: true,
    },
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
    if (example.expand) {
      await expect(page.getByTestId('stage-chip').filter({ hasText: 'UNNEST' })).toHaveCount(1);
      await page.getByTestId('stage-chip').filter({ hasText: 'UNNEST' }).click();
      await page.getByTestId('player-prev').click();
      const child = page.locator('[data-table-id="t:u"]');
      await expect(child.getByTestId('ghost-row')).toHaveCount(21);
      await expect(child).toBeInViewport({ timeout: 15_000 });
      await expect(page.locator('.vs-bracket')).not.toHaveCount(0);
    }
    if (example.finalOnly) await expect(page.getByTestId('final-only-note')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
