import { expect, test } from '@playwright/test';

test('урок VIEW: живые данные и список колонок на момент создания', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/view');
  await expect(page.getByRole('heading', { name: 'VIEW', exact: true })).toBeVisible();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const examples = [
    { sql: 'create view expensive_book', apply: true },
    {
      sql: 'select * from expensive_book order by book_id',
      cells: [
        [0, 0, '2'],
        [1, 0, '10'],
        [2, 0, '11'],
      ],
      count: '3 строки',
    },
    {
      sql: 'select book_id, title from expensive_book where price > 2000',
      cells: [
        [0, 0, '2'],
        [1, 0, '11'],
      ],
      count: '2 строки',
    },
    {
      sql: 'select schemaname, viewname from pg_views',
      cells: [
        [0, 0, 'public'],
        [0, 1, 'expensive_book'],
      ],
      count: '1 строка',
    },
    { sql: 'update book set price = 1500', apply: true },
    { sql: 'select count(*) as n from expensive_book', cells: [[0, 0, '4']], count: '1 строка' },
    { sql: 'create view all_books', apply: true },
    { sql: 'alter table book add column extra_note', apply: true },
    { sql: 'select count(*) as n from information_schema.columns', cells: [[0, 0, '0']], count: '1 строка' },
  ] as const;
  for (const [index, example] of examples.entries()) {
    const block = page.getByTestId('sql-block').filter({ hasText: example.sql });
    if ('apply' in example) {
      await block.getByRole('button', { name: 'Применить' }).click();
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
      if (index === 0) {
        const view = page.getByTestId('table-node-public.expensive_book');
        await expect(view).toHaveAttribute('data-kind', 'view', { timeout: 15_000 });
        await expect(view.getByTestId('row-count')).toHaveText('3');
      }
      if (index === 4) {
        await page.evaluate(async () => {
          const modulePath = '/src/stores/board.ts';
          const store = await import(modulePath);
          store.useBoardStore.getState().focus(['public.expensive_book']);
          store.useBoardStore.getState().requestFrame();
        });
        await expect(
          page.getByTestId('table-node-public.expensive_book').getByTestId('row-count'),
        ).toHaveText('4', { timeout: 15_000 });
      }
      if (index === 6)
        await expect(page.getByTestId('table-node-public.all_books')).toHaveAttribute('data-kind', 'view', {
          timeout: 15_000,
        });
      if (index === 7)
        await expect
          .poll(
            () =>
              page.evaluate(async () => {
                const modulePath = '/src/stores/board.ts';
                const store = await import(modulePath);
                return store.useBoardStore
                  .getState()
                  .schema?.tables.find(
                    (table: { id: string; columns: { name: string }[] }) => table.id === 'public.book',
                  )
                  ?.columns.map((column: { name: string }) => column.name);
              }),
            { timeout: 15_000 },
          )
          .toContain('extra_note');
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
      await expect(page.getByTestId('final-only-note')).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
