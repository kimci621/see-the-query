import { expect, test } from '@playwright/test';

test('урок ролей: чтение разрешено, запись запрещена и роль восстанавливается', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/roles');
  await expect(page.getByRole('heading', { name: 'Роли и права' })).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(10);
  for (let index = 0; index < 10; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [1, 3, 5, 6, 8].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (index === 6) {
      await expect(page.getByText(/42501/).first()).toBeVisible({ timeout: 20_000 });
    } else if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
      if (index === 5) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('auditor', { timeout: 20_000 });
        await expect(page.getByTestId('cell-0-1')).toHaveText('10');
      }
    } else {
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const modulePath = '/src/stores/scene.ts';
              const store = await import(modulePath);
              return store.useSceneStore.getState().trace?.sql;
            }),
          { timeout: 20_000 },
        )
        .toBe(sql);
      await expect(page.getByTestId('result-count')).toHaveText('1 строка', { timeout: 20_000 });
      if (index === 0) await expect(page.getByTestId('cell-0-0')).toHaveText('10');
      if ([2, 4, 9].includes(index)) {
        await expect(page.getByTestId('cell-0-0')).toHaveText(index === 4 ? 'true' : 'false');
        if (index !== 9) await expect(page.getByTestId('cell-0-1')).toHaveText('false');
      }
      if (index === 7) {
        await expect(page.getByTestId('cell-0-0')).not.toHaveText('auditor');
        await expect(page.getByTestId('cell-0-1')).toHaveText('10');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Сброс', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить' }).click();
  await expect
    .poll(
      async () => {
        return page.evaluate(async () => {
          const sandbox = (
            window as unknown as {
              __vsSandbox: {
                preview<T>(
                  fn: (db: { query(sql: string): Promise<{ rows: unknown[][] }> }) => Promise<T>,
                ): Promise<T>;
              };
            }
          ).__vsSandbox;
          return sandbox.preview(
            async (db) =>
              (await db.query("select count(*) from pg_roles where rolname = 'auditor'")).rows[0][0],
          );
        });
      },
      { timeout: 20_000 },
    )
    .toBe(0);
});
