import { expect, type Page, test } from '@playwright/test';

async function openLesson(page: Page, id: string, heading: string) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vs-scene',
      JSON.stringify({ state: { speed: 1, autoplay: false, followCamera: true }, version: 0 }),
    );
  });
  await page.goto(`/l/${id}?lang=en`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 45_000 });
}

async function applyBlock(page: Page, index: number) {
  await page.getByTestId('sql-block').nth(index).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('apply-button')).toContainText('Applied', { timeout: 30_000 });
}

test('английская сцена показывает ожидание и освобождение блокировки', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'locks', 'Locks and deadlocks');
  const scene = page.getByRole('region', { name: 'Waiting for a row lock' });
  await expect(scene).toBeVisible({ timeout: 45_000 });
  for (let i = 0; i < 3; i++) await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.locator('[data-step="3"]')).toHaveAttribute('data-state', 'running');
  await expect(scene).toContainText('B waits for A');
  await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.locator('[data-step="3"]')).toHaveAttribute('data-state', 'done');
});

test('английская сцена MVCC показывает очистку версий', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'mvcc', 'MVCC and row versions');
  const scene = page.getByRole('region', { name: 'PostgreSQL row versions' });
  await expect(scene).toBeVisible({ timeout: 45_000 });
  for (let i = 0; i < 5; i++) await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene).toContainText('VACUUM freed obsolete versions');
  await expect(scene).toContainText('Step 6 of 6');
});

test('английский B-tree показывает путь поиска и план EXPLAIN', async ({ page }) => {
  test.setTimeout(150_000);
  await openLesson(page, 'btree-seq-vs-index', 'B-tree, Seq Scan, and Index Scan');
  const scene = page.getByRole('region', { name: 'B-tree search' });
  await expect(scene).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 3; i++) await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.getByRole('region', { name: 'Search path' })).toContainText('Key 5000');
  await page.getByTestId('sql-block').nth(1).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('5 rows', { timeout: 30_000 });
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByTestId('plan-tree')).toContainText('Seq Scan');
  await expect(page.getByTestId('plan-tree')).toContainText('100,000');
});

test('английская нормализация разделяет увлечения на шесть связей', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'normalization', 'Data normalization');
  await applyBlock(page, 0);
  await applyBlock(page, 1);
  const scene = page.getByRole('region', { name: 'Splitting a table' });
  await expect(scene).toContainText('chess, drawing', { timeout: 30_000 });
  await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.getByRole('region', { name: 'Separate values' }).locator('tbody tr')).toHaveCount(6);
  await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.getByRole('region', { name: 'student_hobby' }).locator('tbody tr')).toHaveCount(6);
});

test('английский полнотекстовый поиск учитывает стоп-слова и обновляет вектор', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'full-text-search', 'Full-text search');
  const scene = page.getByRole('region', { name: 'Text search analysis' });
  await expect(scene).toBeVisible({ timeout: 30_000 });
  await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene.getByRole('list', { name: 'Tokens' })).toContainText('the stop word');
  await scene.getByRole('button', { name: 'Next' }).click();
  await scene.getByRole('button', { name: 'Next' }).click();
  await expect(scene).toContainText("'cossack':7");
  await applyBlock(page, 2);
  await applyBlock(page, 3);
  await page.getByTestId('sql-block').nth(4).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('2', { timeout: 20_000 });
  await applyBlock(page, 6);
  await page.getByTestId('sql-block').nth(7).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('0 rows', { timeout: 20_000 });
});

test('английский урок триггеров откатывает предпросмотр и сохраняет журнал', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'triggers', 'Triggers');
  for (let i = 1; i <= 3; i++) await applyBlock(page, i);
  await page.getByTestId('sql-block').nth(4).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('timeline-caption')).toContainText('possible trigger book_price_log', {
    timeout: 20_000,
  });
  await page.getByTestId('sql-block').nth(5).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
  await applyBlock(page, 6);
  await page.getByTestId('sql-block').nth(7).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('cell-0-1')).toHaveText('890.00', { timeout: 20_000 });
  await expect(page.getByTestId('cell-0-2')).toHaveText('900.00');
});

test('английское секционирование направляет строки в нужные таблицы', async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, 'partitioning', 'Table partitioning');
  for (let i = 0; i < 3; i++) await applyBlock(page, i);
  await applyBlock(page, 4);
  await page.getByTestId('sql-block').nth(5).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('measurement_2024_05', { timeout: 20_000 });
  await expect(page.getByTestId('cell-1-0')).toHaveText('measurement_2024_06');
  await page.getByTestId('sql-block').nth(6).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByRole('region', { name: 'Result' })).toContainText('23514', { timeout: 20_000 });
  await applyBlock(page, 7);
  await applyBlock(page, 8);
  await page.getByTestId('sql-block').nth(9).getByRole('button', { name: 'Show on board' }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('measurement_default', { timeout: 20_000 });
});
