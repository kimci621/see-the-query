import { expect, test } from '@playwright/test';

test('урок нормализации: перенос значений и связь таблиц', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/normalization');
  await expect(page.getByRole('heading', { name: 'Нормализация данных' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Для сцены нужна исходная таблица/)).toBeVisible({ timeout: 30_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(9);
  for (let index = 0; index < 9; index++) {
    const block = blocks.nth(index);
    const sql = (await block.locator('pre').innerText()).trim().replace(/;$/, '');
    const apply = [0, 1, 4, 5, 6].includes(index);
    await block.getByRole('button', { name: apply ? 'Применить' : 'На доску' }).click();
    if (apply) {
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
      if (index === 1) {
        const scene = page.getByRole('region', { name: 'Разделение таблицы' });
        await expect(scene).toContainText('шахматы, рисование', { timeout: 20_000 });
        await scene.getByRole('button', { name: 'Дальше' }).click();
        await expect(
          scene.getByRole('region', { name: 'Отдельные значения' }).locator('tbody tr'),
        ).toHaveCount(6);
        await scene.getByRole('button', { name: 'Дальше' }).click();
        await expect(scene.getByRole('region', { name: 'student_hobby' }).locator('tbody tr')).toHaveCount(6);
        await page.screenshot({ path: testInfo.outputPath('scene.png'), animations: 'disabled' });
      }
      if (index === 6)
        await expect(page.getByText(/Для сцены нужна исходная таблица/)).toBeVisible({ timeout: 20_000 });
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
      await expect(page.getByTestId('result-count')).toHaveText(
        index === 2 ? '1 строка' : index === 8 ? '3 строки' : '6 строк',
        { timeout: 20_000 },
      );
      if (index === 2) await expect(page.getByTestId('cell-0-0')).toHaveText('Вера');
      if (index === 8) {
        await expect(page.getByTestId('cell-0-1')).toContainText('рисование');
        await expect(page.getByTestId('cell-2-1')).toContainText('музыка');
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`), animations: 'disabled' });
  }
});
