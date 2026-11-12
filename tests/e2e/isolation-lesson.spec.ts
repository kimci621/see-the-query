import { expect, test } from '@playwright/test';

test('урок изоляции: настройки и снимки двух сессий', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/isolation');
  await expect(page.getByRole('heading', { name: 'Уровни изоляции транзакций' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(6);
  for (const [index, example] of [
    { apply: false, cell: [0, 1, '890.00'] },
    { apply: false, cell: [0, 0, 'read committed'] },
    { apply: true, cell: [0, 0, 'repeatable read'] },
    { apply: true, cell: [0, 0, 'serializable'] },
    { apply: true, cell: [0, 0, 'read committed'] },
    { apply: false, cell: [0, 0, 'read committed'] },
  ].entries()) {
    await blocks
      .nth(index)
      .getByRole('button', { name: example.apply ? 'Применить' : 'На доску' })
      .click();
    if (example.apply)
      await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
    await expect(page.getByTestId('result-count')).toHaveText('1 строка', { timeout: 15_000 });
    const [row, col, value] = example.cell;
    await expect(page.getByTestId(`cell-${row}-${col}`)).toHaveText(String(value), { timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  const committed = page.getByRole('region', { name: 'Read Committed' });
  for (let i = 0; i < 5; i++) await committed.getByRole('button', { name: 'Дальше' }).click();
  await expect(committed.getByText('B видит новую цену 1,00 в той же транзакции.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('scene-committed.png') });
  const repeatable = page.getByRole('region', { name: 'Repeatable Read' });
  for (let i = 0; i < 6; i++) await repeatable.getByRole('button', { name: 'Дальше' }).click();
  await expect(repeatable.getByText('Ошибка 40001')).toBeVisible();
  await expect(repeatable.getByText('B получила ошибку сериализации 40001.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('scene-repeatable.png') });
});
