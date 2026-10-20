import { expect, test } from '@playwright/test';

// P8.38: много чипов не выталкивают подпись плеера под редактор
const QUERY = `select a.name, count(*) as all_rows, count(b.book_id) as books
from author a left join book b on b.author_id = a.author_id
group by a.author_id, a.name order by books desc, a.name`;

const CHIPS = ['FROM', 'FROM', 'LEFT JOIN', 'GROUP BY', 'SELECT', 'ORDER BY'];

// P8.57: сколько чипов из 6 помещается в ленту целиком
for (const { minChips, ...viewport } of [
  { width: 1024, height: 768, minChips: 4 },
  { width: 1280, height: 800, minChips: 4 },
  { width: 1440, height: 900, minChips: 6 },
]) {
  test(`подпись плеера видна целиком при 6 чипах на ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/l/select-basics');
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^="table-node-"]').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(QUERY);
    await expect(page.getByTestId('stage-chip')).toHaveText(CHIPS, { timeout: 5_000 });

    // лента чипов не отдаёт ширину настройкам плеера: видно не меньше minChips чипов целиком
    const visibleChips = await page
      .getByRole('list', { name: 'Шаги выполнения запроса' })
      .evaluate((list) => {
        const lr = list.getBoundingClientRect();
        return Array.from(list.querySelectorAll('[data-testid="stage-chip"]')).filter((chip) => {
          const r = chip.getBoundingClientRect();
          return r.left >= lr.left - 0.5 && r.right <= lr.right + 0.5;
        }).length;
      });
    expect(visibleChips).toBeGreaterThanOrEqual(minChips);

    // последний чип кликабелен и подпись про его шаг
    await page.getByTestId('stage-chip').last().click();
    const caption = page.getByTestId('timeline-caption');
    await expect(caption).toContainText('ORDER BY');

    const panel = await page.getByRole('region', { name: 'Таймлайн' }).boundingBox();
    const editor = await page.getByRole('region', { name: 'Редактор' }).boundingBox();
    const box = await caption.boundingBox();
    if (!panel || !editor || !box) throw new Error('нет панели, редактора или подписи');
    await page.screenshot({
      path: test.info().outputPath(`timeline-${viewport.width}.png`),
      clip: { x: panel.x, y: panel.y - 40, width: panel.width, height: panel.height + 80 },
    });
    // подпись не сплющена flex-колонкой: строка помещается по высоте
    expect(box.height).toBeGreaterThanOrEqual(await caption.evaluate((el) => el.scrollHeight));
    expect(box.y).toBeGreaterThanOrEqual(panel.y);
    expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
    expect(box.y + box.height).toBeLessThanOrEqual(editor.y);
  });
}
