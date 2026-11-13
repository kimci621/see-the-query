import { expect, test } from '@playwright/test';

test('вставка показывает реальные секции и откатывает предпросмотр', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/select-basics');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    const sandbox = (window as unknown as { __vsSandbox: { apply(sql: string): Promise<unknown> } })
      .__vsSandbox;
    await sandbox.apply(`
      create table measurement (city_id int not null, logdate date not null, peaktemp int)
        partition by range (logdate);
      create table measurement_may partition of measurement
        for values from ('2024-05-01') to ('2024-06-01');
      create table measurement_june partition of measurement
        for values from ('2024-06-01') to ('2024-07-01');
    `);
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const modulePath = '/src/stores/board.ts';
          const store = await import(modulePath);
          return store.useBoardStore
            .getState()
            .schema?.tables.some((table: { id: string }) => table.id === 'public.measurement_june');
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(`insert into measurement values
    (1, '2024-05-10', 20), (1, '2024-06-15', 25) returning city_id, logdate, peaktemp`);
  await expect(page.getByTestId('timeline-caption')).toContainText('строк: 2, секций: 2', {
    timeout: 20_000,
  });
  const may = page.locator('[data-testid="ghost-table"][data-table-id="t:public.measurement_may"]');
  const june = page.locator('[data-testid="ghost-table"][data-table-id="t:public.measurement_june"]');
  await expect(may).toContainText('2024-05-10');
  await expect(june).toContainText('2024-06-15');
  await expect(may).toContainText('секция');
  await page.screenshot({ path: testInfo.outputPath('routing.png'), animations: 'disabled' });
  const count = await page.evaluate(async () => {
    const sandbox = (
      window as unknown as {
        __vsSandbox: {
          preview<T>(
            fn: (db: { query(sql: string): Promise<{ rows: unknown[][] }> }) => Promise<T>,
          ): Promise<T>;
        };
      }
    ).__vsSandbox;
    return sandbox.preview(async (db) => (await db.query('select count(*) from measurement')).rows[0][0]);
  });
  expect(count).toBe(0);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText("insert into measurement values (1, '2024-08-01', 25)");
  const result = page.getByRole('region', { name: 'Результат' });
  await expect(result).toContainText('23514', { timeout: 20_000 });
  await expect(result).toContainText('Нет подходящей секции');
  await expect(result).not.toContainText('undefined');
  await page.screenshot({ path: testInfo.outputPath('missing-partition.png'), animations: 'disabled' });
});
