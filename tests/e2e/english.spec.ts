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
  await expect(page.getByRole('heading', { name: 'SELECT: columns, expressions and aliases' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page).toHaveURL(/\/l\/select-basics\?lang=ru&source=test#part$/);
  await expect(page.getByRole('heading', { name: /SELECT:/ })).toBeVisible();
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'SELECT: columns, expressions and aliases' })).toBeVisible();
});

test('быстрая смена языка сохраняет введённый SQL', async ({ page }) => {
  await page.goto('/l/select-basics?lang=ru');
  const editor = page.getByRole('textbox', { name: 'SQL-запрос' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('select 123;');
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.getByRole('heading', { name: 'SELECT: columns, expressions and aliases' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.getByRole('textbox', { name: 'SQL-запрос' })).toHaveText('select 123;');
});

test('английская песочница выполняет запросы и хранит изменения отдельно от русской', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/l/select-basics?lang=en');
  await expect(page.getByRole('heading', { name: 'SELECT: columns, expressions and aliases' })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveText('select title, price from book;');
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

test('первый вход открывает русский урок и сохраняет выбор языка', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Как пользоваться доской' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await expect(page.getByRole('heading', { name: 'How to use the board' })).toBeVisible();
  await page.goto('/l/select-basics');
  await expect(page.getByRole('heading', { name: 'SELECT: columns, expressions and aliases' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('английская навигация и поиск сохраняют язык при переходах', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/l/how-to-use?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('link', { name: /1\.1 Tables, rows, columns and cells/ }).click();
  await expect(page.getByRole('heading', { name: 'Tables, rows, columns and cells' })).toBeVisible();
  await page.getByRole('link', { name: '⟨ 0.1 How to use the board' }).click();
  await expect(page.getByRole('heading', { name: 'How to use the board' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search lessons' }).fill('partitioning');
  await page.getByRole('option', { name: '14.5 Table partitioning' }).click();
  await expect(page.getByRole('heading', { name: 'Table partitioning' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/l/how-to-use');
  await expect(page.getByRole('heading', { name: 'How to use the board' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('отмена и сброс меняют только журнал выбранного языка', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/l/select-basics?lang=en');
  await expect(page.getByTestId('table-node-public.book')).toBeVisible({ timeout: 30_000 });
  await writeSql(page, "insert into author (name) values ('English journal')");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Applied', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await writeSql(page, "insert into author (name) values ('Russian journal')");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await writeSql(page, "select count(*) from author where name = 'English journal'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('1', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await writeSql(page, "select count(*) from author where name = 'Russian journal'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('1', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
  await writeSql(page, "insert into author (name) values ('Russian reset')");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Применено', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Переключить язык на английский' }).click();
  await writeSql(page, "insert into author (name) values ('English reset')");
  await page.getByTestId('apply-button').click();
  await expect(page.getByTestId('apply-button')).toContainText('Applied', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset', exact: true }).click();
  await writeSql(page, "select count(*) from author where name = 'English reset'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Switch language to Russian' }).click();
  await writeSql(page, "select count(*) from author where name = 'Russian reset'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('1', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Сброс', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить', exact: true }).click();
  await writeSql(page, "select count(*) from author where name = 'Russian reset'");
  await expect(page.getByTestId('cell-0-0')).toHaveText('0', { timeout: 20_000 });
});
