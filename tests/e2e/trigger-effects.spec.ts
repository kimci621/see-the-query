import { expect, test } from '@playwright/test';

test('изменения после триггера видны на доске и откатываются после предпросмотра', async ({
  page,
}, testInfo) => {
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
      create table price_log (book_id bigint, old_price numeric, new_price numeric);
      create function log_price() returns trigger language plpgsql as $$
      begin insert into price_log values (new.book_id, old.price, new.price); return new; end $$;
      create trigger price_changed after update on book for each row
      when (old.price is distinct from new.price) execute function log_price();
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
            .schema?.tables.some((table: { id: string }) => table.id === 'public.price_log');
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'update book set price = price + 10 where book_id = 1 returning book_id, price',
  );
  await expect(page.getByTestId('timeline-caption')).toContainText('возможный триггер price_changed', {
    timeout: 20_000,
  });
  const ghost = page.locator('[data-testid="ghost-table"][data-table-id="t:public.price_log"]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText('Добавлено: price_log');
  await expect(ghost).toContainText('побочный эффект');
  await expect(ghost).toContainText('900.00');
  await page.screenshot({ path: testInfo.outputPath('trigger.png'), animations: 'disabled' });
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
    return sandbox.preview(async (db) => (await db.query('select count(*) from price_log')).rows[0][0]);
  });
  expect(count).toBe(0);
});
