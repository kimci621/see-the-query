import { expect, test } from '@playwright/test';

test('урок полнотекстового поиска: лексемы, индекс и обновление вектора', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/full-text-search');
  await expect(page.getByRole('heading', { name: 'Полнотекстовый поиск' })).toBeVisible({ timeout: 30_000 });
  const scene = page.getByRole('region', { name: 'Разбор текста для поиска' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByRole('list', { name: 'Токены' })).toContainText('о стоп-слово');
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene).toContainText("'казачеств':5");
  await page.screenshot({ path: testInfo.outputPath('scene.png'), animations: 'disabled' });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(8);
  for (let index = 0; index < 8; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [2, 3, 6].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
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
      const count =
        index === 1 ? '2 строки' : index === 5 ? '3 строки' : index === 7 ? '0 строк' : '1 строка';
      await expect(page.getByTestId('result-count')).toHaveText(count, { timeout: 20_000 });
      if (index === 0) {
        const cell = page.getByRole('button', { name: 'Строка 1, столбец 1: показать полное значение' });
        await cell.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText("'казачеств':5");
        await expect(dialog).toContainText("'чита':6");
        await page.keyboard.press('Escape');
      }
      if (index === 1) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('6');
        await expect(page.getByTestId('cell-1-0')).toHaveText('8');
      }
      if (index === 4) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('2');
        await expect(page.getByTestId('cell-0-1')).toHaveText('5');
      }
      if (index === 5) {
        await expect(page.getByTestId('cell-0-0')).toHaveText('2');
        await expect(page.getByTestId('cell-0-1')).toHaveText('0.0985');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
