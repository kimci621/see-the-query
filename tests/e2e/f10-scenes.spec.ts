import { expect, type Page, test } from '@playwright/test';

async function openBoard(page: Page, lesson: string) {
  await page.goto(`/l/${lesson}`);
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
}

async function typeQuery(page: Page, sql: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
}

async function waitSceneEnd(page: Page, rows: number) {
  await expect(page.getByTestId('ghost-row')).toHaveCount(rows, { timeout: 15_000 });
  await expect(page.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Играть', {
    timeout: 15_000,
  });
}

test.describe('сцены Ф10: CTE, рекурсия, множества и окна', () => {
  test('CTE: пунктирная таблица с именем recent, дальше обычный SELECT', async ({ page }) => {
    await openBoard(page, 'cte');
    await typeQuery(
      page,
      "with recent as (select * from orders where created_at >= '2024-05-01 00:00:00+03'::timestamptz) select order_id, status from recent order by order_id",
    );
    await expect(page.getByTestId('stage-chip')).toHaveText(['WITH recent', 'FROM', 'SELECT', 'ORDER BY'], {
      timeout: 10_000,
    });
    await waitSceneEnd(page, 2);
    await page.getByTestId('stage-chip').nth(0).click();
    const dashed = page.locator('.vs-ghost--dashed');
    await expect(dashed).toHaveCount(1);
    await expect(dashed).toContainText('recent');
  });

  test('рекурсивный CTE: слои итераций видны отдельными таблицами', async ({ page }) => {
    await openBoard(page, 'recursive-cte');
    await typeQuery(
      page,
      `with recursive tree as (
        select employee_id, name, manager_id, 1 as level from employee where manager_id is null
        union all
        select e.employee_id, e.name, e.manager_id, t.level + 1
        from employee e join tree t on e.manager_id = t.employee_id
      ) select employee_id, name, level from tree order by level, employee_id`,
    );
    await expect(page.getByTestId('stage-chip')).toHaveText(
      ['RECURSIVE tree', 'FROM', 'SELECT', 'ORDER BY'],
      { timeout: 10_000 },
    );
    await waitSceneEnd(page, 8);
    await page.getByTestId('stage-chip').nth(0).click();
    await expect(page.getByTestId('ghost-table')).toHaveCount(5);
    await expect(page.getByTestId('timeline-caption')).toContainText('итераций');
  });

  test('UNION: две ветви, затем итог', async ({ page }) => {
    await openBoard(page, 'set-operations');
    await typeQuery(
      page,
      "select name from author where country = 'Россия' union select name from author where country = 'Франция' order by name",
    );
    await expect(page.getByTestId('stage-chip')).toHaveText(['UNION', 'ORDER BY'], { timeout: 10_000 });
    await waitSceneEnd(page, 5);
    await page.getByTestId('stage-chip').nth(0).click();
    await page.getByTestId('player-prev').click();
    await page.getByTestId('player-prev').click();
    await expect(page.getByTestId('ghost-table')).toHaveCount(2);
    await expect(page.getByTestId('timeline-caption')).toContainText('ветви считаются отдельно');
  });

  test('окно: рамка едет по строкам партиции', async ({ page }) => {
    await openBoard(page, 'window-frame');
    await typeQuery(
      page,
      'select kind, count(*) over (order by happened_at rows between unbounded preceding and current row) as rows_cnt from event where order_id = 3 order by happened_at',
    );
    await expect(page.getByTestId('stage-chip')).toHaveText(['FROM', 'WHERE', 'OVER', 'SELECT', 'ORDER BY'], {
      timeout: 10_000,
    });
    await waitSceneEnd(page, 3);
    await page.getByTestId('stage-chip').nth(2).click();
    await page.getByTestId('player-prev').click();
    await expect(page.locator('.vs-bracket', { hasText: 'рамка' })).toHaveCount(1);
    await expect(page.getByTestId('timeline-caption')).toContainText('ROWS BETWEEN');
  });
});
