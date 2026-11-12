import { expect, test } from '@playwright/test';

test('урок SAVEPOINT: частичный откат и освобождение точки', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/savepoint');
  await expect(page.getByRole('heading', { name: 'SAVEPOINT', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(7);
  for (const [index, example] of [
    { apply: false, cell: [0, 1, '350.00'] },
    { apply: true, cell: [0, 1, '999.00'] },
    { apply: false, cell: [0, 1, '999.00'] },
    { apply: true, error: /нарушает ограничение|check constraint/i },
    { apply: false, cell: [0, 1, '0'] },
    { apply: true, cell: [0, 1, '890.00'] },
    { apply: true, error: /3B001|savepoint .* does not exist/i },
  ].entries()) {
    await blocks
      .nth(index)
      .getByRole('button', { name: example.apply ? 'Применить' : 'На доску' })
      .click();
    if (example.error) {
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: example.error }).first(),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      if (example.apply)
        await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
      await expect(page.getByTestId('result-count')).toHaveText('1 строка', { timeout: 15_000 });
      const [row, col, value] = example.cell;
      await expect(page.getByTestId(`cell-${row}-${col}`)).toHaveText(String(value));
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  const scene = page.getByRole('region', { name: 'Ошибка и SAVEPOINT' });
  for (let i = 0; i < 3; i++) await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.getByText('A может продолжить транзакцию.')).toBeVisible();
});
