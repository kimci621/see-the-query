import { expect, test } from '@playwright/test';

test('урок транзакций: фиксация, откат и ошибка ограничения', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto('/l/transactions');
  await expect(page.getByRole('heading', { name: 'BEGIN, COMMIT, ROLLBACK и ACID' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 20_000 });
  const blocks = page.getByTestId('sql-block');
  await expect(blocks).toHaveCount(7);
  for (const [index, example] of [
    { apply: false, count: '1 строка', cells: [[0, 1, '2400.00']] },
    { apply: true, count: '1 строка', cells: [[0, 1, '7.00']] },
    { apply: true, count: '1 строка', cells: [[0, 1, '7.00']] },
    {
      apply: true,
      count: '2 строки',
      cells: [
        [0, 1, '890.00'],
        [1, 1, '7.00'],
      ],
    },
    { apply: false, count: '1 строка', cells: [[0, 1, '0']] },
    { apply: true, error: true },
    { apply: false, count: '1 строка', cells: [[0, 1, '0']] },
  ].entries()) {
    const button = blocks.nth(index).getByRole('button', { name: example.apply ? 'Применить' : 'На доску' });
    await button.click();
    if (example.error) {
      await expect(page.getByText(/нарушает ограничение|check constraint/i).first()).toBeVisible({
        timeout: 15_000,
      });
    } else {
      if (example.apply)
        await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
      await expect(page.getByTestId('result-count')).toHaveText(example.count as string, { timeout: 15_000 });
      for (const [row, col, value] of example.cells ?? []) {
        await expect(page.getByTestId(`cell-${row}-${col}`)).toHaveText(String(value));
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`example-${index + 1}.png`) });
  }
  const editor = page.locator('.cm-content');
  await editor.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'begin; update book set price = 99 where book_id = 2; rollback; select price from book where book_id = 2;',
  );
  await page.getByTestId('apply-all-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 15_000 });
  await expect(page.getByTestId('cell-0-0')).toHaveText('7.00');
  await page.getByTestId('apply-all-button').click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('7.00');
  const scene = page.getByRole('region', { name: 'Фиксация транзакции' });
  await scene.getByRole('button', { name: 'Дальше' }).click();
  await expect(scene.locator('[data-step="1"]')).toHaveAttribute('data-state', 'done');
});
