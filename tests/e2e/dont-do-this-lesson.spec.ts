import { expect, test } from '@playwright/test';

test('урок ловушек: NULL, границы времени и char', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/dont-do-this');
  await expect(page.getByRole('heading', { name: 'Частые ловушки PostgreSQL' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.author')).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(8);
  for (let index = 0; index < 8; index++) {
    const block = blocks.nth(index);
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
        { timeout: 20_000 },
      )
      .toBe(sql);
    const count = index === 0 || index === 3 ? '0 строк' : index === 4 ? '2 строки' : '1 строка';
    await expect(page.getByTestId('result-count')).toHaveText(count, { timeout: 20_000 });
    if (index === 1 || index === 2) await expect(page.getByTestId('cell-0-0')).toHaveText('Борис Пастернак');
    if (index === 4) {
      await expect(page.getByTestId('cell-0-0')).toHaveText('Простой Python');
      await expect(page.getByTestId('cell-1-0')).toHaveText('Изучаем Python');
    }
    if (index === 5) {
      await expect(page.getByTestId('cell-0-0')).toHaveText('true');
      await expect(page.getByTestId('cell-0-1')).toHaveText('false');
    }
    if (index === 6) await expect(page.getByTestId('cell-0-0')).toHaveText('3');
    if (index === 7) {
      await expect(page.getByTestId('cell-0-0')).toHaveText('1');
      await expect(page.getByTestId('cell-0-1')).toHaveText('4');
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
