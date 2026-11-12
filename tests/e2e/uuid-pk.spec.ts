import { expect, test } from '@playwright/test';

test('урок о UUID: ключ, размер и ошибка формата', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/uuid-pk');
  await expect(page.getByRole('heading', { name: 'UUID и первичный ключ', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'select book_id, pg_typeof(book_id)', cells: ['1', 'bigint'] },
    { sql: 'select count(*) as n from book', cells: ['11'] },
    { sql: 'select gen_random_uuid() as u', cells: [null, 'false'], uuid: true },
    {
      sql: "select 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid",
      cells: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'uuid'],
    },
    { sql: 'pg_column_size(1::bigint)', cells: ['8', '16'] },
    { sql: "select md5('a')", cells: ['0cc175b9c0f1b6a831c399e269772661'] },
    { sql: "select 'не-uuid'::uuid", error: '22P02' },
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
    if (example.cells) {
      await expect(page.getByTestId('result-count')).toHaveText('1 строка');
      for (const [column, value] of example.cells.entries())
        if (value !== null) await expect(page.getByTestId(`cell-0-${column}`)).toHaveText(value);
      if (example.uuid) await expect(page.getByTestId('cell-0-0')).toHaveText(/^[0-9a-f-]{36}$/);
      const ghost = page.getByTestId('ghost-table').last();
      await expect(ghost).toBeVisible();
      await expect(ghost).toBeInViewport({ timeout: 15_000 });
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
