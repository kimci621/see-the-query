import { expect, test } from '@playwright/test';

test('урок о типах: все примеры отправляются на доску', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/types-casting');
  await expect(page.getByRole('heading', { name: 'Типы и приведение' })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'price', exact: true }).first().hover();
  await expect(page.getByTestId('table-node-public.book').locator('[data-column="price"]')).toHaveAttribute(
    'data-highlighted',
    'true',
  );
  await page.getByRole('button', { name: 'book', exact: true }).first().hover();
  await expect(page.getByTestId('table-node-public.book').locator('[data-column="title"]')).toHaveAttribute(
    'data-highlighted',
    'true',
  );
  const examples = [
    { sql: 'select title, price, pages, published_at, tags', result: 'Тихий Дон', count: '1 строка' },
    { sql: 'where title = 5', error: '42883' },
    { sql: "price::text || ' ₽'", result: '890.00 ₽' },
    { sql: "'42'::int + 1", result: '43' },
    { sql: "cast('42' as integer) + 1", result: '43' },
    { sql: "'abc'::int", error: '22P02' },
    { sql: "price > '500' order", count: '7 строк' },
    { sql: "price > '500'::text", error: '42883' },
    { sql: 'price > 500 and price < 1000', count: '4 строки' },
    { sql: "select ''::int", error: '22P02' },
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
    if (example.error)
      await expect(page.getByTestId('pg-error')).toContainText(example.error, { timeout: 15_000 });
    if (example.count)
      await expect(page.getByTestId('result-count')).toHaveText(example.count, { timeout: 15_000 });
    if (example.result)
      await expect(page.getByTestId('results-panel')).toContainText(example.result, { timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  await expect(page.getByText('Проверь себя', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Тип колонки: какие значения и операции возможны.', { exact: false }),
  ).toBeVisible();
});
