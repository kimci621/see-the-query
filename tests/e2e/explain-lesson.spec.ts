import { expect, test } from '@playwright/test';

test('урок EXPLAIN: оценки, фактический план и откат UPDATE', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/explain');
  await expect(page.getByRole('heading', { name: 'EXPLAIN и EXPLAIN ANALYZE' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('table-node-public.orders')).toBeVisible({ timeout: 45_000 });
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
    if ([1, 2, 4, 6].includes(index)) {
      await expect(page.getByTestId('result-count')).toHaveText('EXPLAIN', { timeout: 20_000 });
      await expect(page.getByTestId('cell-0-0')).toContainText('Plan');
      await expect(page.getByTestId('final-only-note')).toBeVisible();
      if (index === 2) {
        const open = page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' });
        await open.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Значение ячейки' });
        await expect(dialog).toContainText('Rows Removed by Filter');
        await expect(dialog).toContainText('99995');
        await page.screenshot({ path: testInfo.outputPath('full-json.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 640, height: 800 });
        const content = dialog.getByLabel('Полное значение');
        await content.focus();
        await page.keyboard.press('PageDown');
        await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath('full-json-narrow.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.keyboard.press('Escape');
        await expect(open).toBeFocused();
      }
    } else {
      const count = index === 0 ? '5 строк' : index === 3 ? '10 строк' : '1 строка';
      await expect(page.getByTestId('result-count')).toHaveText(count, { timeout: 20_000 });
      if (index === 5 || index === 7) await expect(page.getByTestId('cell-0-1')).toHaveText('new');
      if (index === 0) {
        await page.getByRole('tab', { name: 'План' }).click();
        const scan = page.getByTestId('plan-tree').getByRole('button', { name: /Seq Scan по public.orders/ });
        await scan.focus();
        await expect(page.getByTestId('stage-chip').first()).toHaveAttribute('data-plan-hover', 'true');
        await page.screenshot({ path: testInfo.outputPath('plan.png') });
        await page.getByRole('tab', { name: 'Результат' }).click();
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
});
