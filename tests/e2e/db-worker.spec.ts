import { expect, type Page, test } from '@playwright/test';

// Минимальный тип ручки window.__vsSandbox (ставит SandboxProvider в dev-сборке)
interface SandboxHandle {
  status: string;
  journal(): string[];
  apply(sql: string): Promise<unknown>;
  preview<T>(fn: (db: { query(sql: string): Promise<{ rows: unknown[][] }> }) => Promise<T>): Promise<T>;
}
type WithSandbox = Window & { __vsSandbox?: SandboxHandle };

async function waitReady(page: Page) {
  await page.waitForFunction(() => (window as WithSandbox).__vsSandbox?.status === 'ready', null, {
    timeout: 20_000,
  });
}

const countReviews = (page: Page) =>
  page.evaluate(() =>
    (window as WithSandbox).__vsSandbox?.preview(
      async (db) => (await db.query('select count(*)::int from review')).rows[0][0],
    ),
  );

test('теория видна сразу, Postgres поднимается в worker', async ({ page }) => {
  await page.goto('/l/select-basics');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await waitReady(page);
  expect(await countReviews(page)).toBe(10);
});

test('сторож прерывает зависший запрос, песочница восстанавливает журнал', async ({ page }) => {
  await page.goto('/l/select-basics');
  await waitReady(page);
  const result = await page.evaluate(async () => {
    const sandbox = (window as WithSandbox).__vsSandbox as SandboxHandle;
    await sandbox.apply('delete from review');
    const started = performance.now();
    const code = await sandbox
      .preview((db) => db.query('select pg_sleep(10)'))
      .then(
        () => 'none',
        (e: { db?: { code: string } }) => e.db?.code,
      );
    return { code, ms: performance.now() - started, journal: sandbox.journal(), status: sandbox.status };
  });
  expect(result.code).toBe('VS001');
  expect(result.ms).toBeGreaterThan(2900);
  expect(result.ms).toBeLessThan(8000);
  expect(result).toMatchObject({ journal: ['delete from review'], status: 'ready' });
  expect(await countReviews(page)).toBe(0);
  await expect(page.getByText('Запрос выполнялся дольше 3 секунд.', { exact: false })).toBeVisible();
});

test('журнал урока переживает перезагрузку страницы', async ({ page }) => {
  await page.goto('/l/select-basics');
  await waitReady(page);
  await page.evaluate(() => (window as WithSandbox).__vsSandbox?.apply('delete from review'));
  await page.reload();
  await waitReady(page);
  expect(await countReviews(page)).toBe(0);
});
