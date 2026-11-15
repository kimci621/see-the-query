import { expect, type Page, test } from '@playwright/test';

async function writeSql(page: Page, sql: string) {
  const editor = page.locator('.cm-content');
  await editor.click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

test('переведённый первый урок открывается на обоих языках', async ({ page }) => {
  await page.goto('/l/how-to-use?lang=en');
  await expect(page.getByRole('heading', { name: 'How to use the board' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.cm-content')).toHaveText('select title, price from book;');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.getByRole('heading', { name: 'Как пользоваться доской' })).toBeVisible();
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.getByRole('heading', { name: 'How to use the board' })).toBeVisible();
});

test('язык в ссылке, переключатель и история сохраняют урок и параметры', async ({ page }) => {
  await page.goto('/l/select-basics?lang=en&source=test#part');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page).toHaveURL(/\/l\/select-basics\?lang=ru&source=test#part$/);
  await expect(page.getByRole('heading', { name: /SELECT:/ })).toBeVisible();
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
});

test('быстрая смена языка сохраняет введённый SQL', async ({ page }) => {
  await page.goto('/l/select-basics?lang=ru');
  const editor = page.getByRole('textbox', { name: 'SQL-запрос' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('select 123;');
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.getByRole('textbox', { name: 'SQL-запрос' })).toHaveText('select 123;');
});

test('английская песочница выполняет запросы и хранит изменения отдельно от русской', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/l/select-basics?lang=en');
  await expect(page.getByRole('heading', { name: 'Translation coming soon' })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });

  await writeSql(page, 'select title from book where book_id = 10');
  await expect(page.getByTestId('cell-0-0')).toHaveText('Simple Python', { timeout: 15_000 });
  await writeSql(
    page,
    'select b.title, a.name from book b join author a using (author_id) where b.book_id = 1',
  );
  await expect(page.getByTestId('cell-0-0')).toHaveText('And Quiet Flows the Don', { timeout: 15_000 });
  await expect(page.getByTestId('cell-0-1')).toHaveText('Mikhail Sholokhov');

  await writeSql(page, "insert into author (name) values ('English author') returning name");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('English author', { timeout: 15_000 });
  await writeSql(page, 'select nme from book');
  await expect(page.getByTestId('pg-explain-title')).toContainText('Column nme does not exist', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('pg-original')).toContainText('nme');

  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.getByRole('heading', { name: /SELECT:/ })).toBeVisible();
  await writeSql(page, "select count(*) from author where name = 'English author'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.locator('.cm-content')).toHaveText('select nme from book');
  await writeSql(page, "select count(*) from author where name = 'English author'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('1', { timeout: 20_000 });
  await page.reload();
  await expect(page.locator('.cm-content')).toHaveText(
    "select count(*) from author where name = 'English author'",
  );
  await expect(page.getByTestId('cell-0-0')).toHaveText('1', { timeout: 30_000 });
});

test('неудачная вставка не меняет сохранённый номер после восстановления', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/l/how-to-use?lang=en');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 60_000 });
  await writeSql(
    page,
    "insert into customer (name, email, created_at) values ('X', 'anna@example.com', now())",
  );
  await page.getByTestId('apply-button').click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
    'This value already exists',
    {
      timeout: 30_000,
    },
  );

  await page.reload();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 60_000 });
  await writeSql(
    page,
    "insert into customer (name, email, created_at) values ('New Customer', 'new@example.com', now()) returning customer_id",
  );
  await expect(page.getByTestId('cell-0-0')).toHaveText('8', { timeout: 30_000 });
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Applied', { timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 60_000 });
  await writeSql(page, "select customer_id from customer where email = 'new@example.com'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('8', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await writeSql(page, "select customer_id from customer where email = 'new@example.com'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('8', { timeout: 30_000 });
});
