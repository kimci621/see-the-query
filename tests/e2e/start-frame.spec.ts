import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Все MVP-уроки из content/lessons: новый урок попадает в проверку сам
const LESSONS = join(process.cwd(), 'content/lessons');
const mvpLessons = readdirSync(LESSONS, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.mdx'))
  .map((f) => readFileSync(join(LESSONS, f), 'utf8'))
  .filter((src) => /^mvp: true$/m.test(src))
  .map((src) => /^id: (.+)$/m.exec(src)?.[1] ?? '');

// Что на стартовом кадре не так (спека 3.4, P8.13). Видимая зона: доска без нижней полосы хрома
// (кнопки зума, плашка версии). Таблица фокуса: шапка целиком в зоне, по ширине хотя бы имя
// (широкую таблицу кадр держит за левый край). Любая другая таблица, если видна, тоже со шапкой
function problems(): string[] {
  const board = document.querySelector('.react-flow');
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!board || !viewport) return ['нет доски'];
  const flow = board.getBoundingClientRect();
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const bottom = flow.bottom - 3.5 * rem;
  const zoom = Number(/scale\(([\d.]+)\)/.exec(viewport.style.transform)?.[1]);
  const out: string[] = [];
  if (!(zoom >= 0.6 - 1e-3)) out.push(`зум ${zoom}`);
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="table-node-"]'));
  if (!nodes.some((el) => el.dataset.focused)) out.push('нет таблиц фокуса');
  for (const el of nodes) {
    const n = el.getBoundingClientRect();
    const focused = Boolean(el.dataset.focused);
    const hidden =
      n.bottom <= flow.top || n.top >= flow.bottom || n.right <= flow.left || n.left >= flow.right;
    if (hidden && !focused) continue;
    const head = el.querySelector('header')?.getBoundingClientRect();
    const name = el.querySelector('.vs-table-name')?.getBoundingClientRect();
    const ok =
      head &&
      name &&
      head.top >= flow.top - 0.5 &&
      head.bottom <= bottom + 0.5 &&
      name.left >= flow.left - 0.5 &&
      name.right <= flow.right + 0.5;
    if (!ok) out.push(`${el.dataset.testid}${focused ? ' (фокус)' : ''}: шапка не в кадре`);
  }
  return out;
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test.describe(`стартовый кадр на ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    for (const id of mvpLessons) {
      test(`${id}: шапки таблиц над хромом, зум не мельче 0.6`, async ({ page }) => {
        await page.goto(`/l/${id}`);
        await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => page.evaluate(problems), { timeout: 5_000 }).toEqual([]);
      });
    }
  });
}

test('MVP-уроки нашлись', () => {
  expect(mvpLessons.length).toBeGreaterThanOrEqual(13);
  expect(mvpLessons).not.toContain('');
});
